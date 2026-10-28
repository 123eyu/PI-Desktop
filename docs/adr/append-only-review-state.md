# ADR: Append-only review state

- Status: Implemented candidate
- Date: 2026-10-28
- Related: Issue #1836, ADR 0043, ADR 0060, ADR 0127

## Context

Rolling back one historical tool card loaded the complete session and called
`replace_messages` to persist `details.review.state`. This rewrote the entire
transcript and rebuilt every SQLite message index row under the Host state
lock. The work scaled with retained image/output bytes, although only one
small metadata value changed. Appending a replacement message directly would
move its physical position and break bounded history navigation.

## Decision

Append a distinct `tool_review_state` line keyed by message and snapshot IDs.
Keep the original message line and all message-window coordinates unchanged.
Replay the latest matching state in full reads, bounded reads and tool-parent
lookups. Index these small mutation offsets separately in layout-cache format
3; rebuild previous disposable cache versions normally. Cache parsed message
identities alongside the offsets, and validate the selected identity against
its original line. Invalid rows keep an unresolved identity and continue to
expose the existing point-read decoding errors.

Cache reuse requires a matching file identity and modification/change-time
stamp. Only a Host-owned append from the proven generation advances an
in-memory prefix's generation without rescanning. A lagging disk cache or an
unrecognized change is rebuilt, including an in-place edit followed by append.

Validate the owning tool snapshot before appending, and avoid writing duplicate
state acknowledgements. Preserve file-first durability through the existing
flush/fsync append path, then update only the session timestamp. Existing
rewrite, fork and revision operations consume the effective message projection
and thus fold its state into their new payloads.

## Consequences

A review update writes only its IDs and state instead of retained history.
Target lookup scans cached identities and reads only its selected message;
building a cold layout parses identities once without retaining message bodies.
The first mutation after restart still performs the existing storage-integrity
verification. Ordinary reads
also read the small state log. Deliberate transcript replacement and other
metadata writers retain their existing rewrite behavior.

The line type is additive to transcript format 2 and requires no database or
RPC migration. Older readers skip it and may display stale review-card state;
the separate snapshot metadata still prevents a second destructive rollback.
Intentional rewrites fold state into canonical message payloads.

## Alternatives

- Calling `update_message` still copies all historical bytes for a non-tail
  message and therefore leaves the reported review trigger.
- Appending the whole tool message creates a new physical message position.
- A separate metadata file adds another authoritative storage and recovery
  lifecycle; the existing transcript append path already provides durability.
