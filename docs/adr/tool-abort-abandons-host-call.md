# ADR: A user stop ends the turn even when the running tool cannot be cancelled

- Status: Accepted for implementation
- Date: 2026-10-20
- Issues: #1767
- Amends: spec 03-runtime/03-tools-and-permissions.md §3

## Context

The runtime registered an abort listener for every tool call but returned
immediately unless the tool was `Bash` or `GenerateImages`. For every other
tool — `Grep`, `Read`, `Glob`, `WebFetch`, plugin tools — the listener was
inert, and `tools.execute` was awaited with no deadline and no race against the
signal. The agent loop only re-checks `signal.aborted` between tool calls, so a
single long call held the turn, and the session, hostage: one report measured a
`Grep` that ran 21m39s after the user clicked Stop six times, with the abort
applying in the same millisecond the tool finally returned.

Three facts constrain the fix:

1. `tools.abort` only cancels what host-core can cancel: it clears a pending
   approval and kills a `Bash` / `GenerateImages` process. Every other tool runs
   to completion inside the Rust host whatever the runtime sends.
2. A `tools.abort` for a tool call id that has no active cancellation registers
   a 60s tombstone in `pending_bash_aborts`, which a later `Bash` reusing that
   id would inherit as an immediate kill.
3. `TOOL_ABORTED` already means "the tool was cancelled by a user stop or a turn
   abort before it finished" (spec 03-runtime/08-error-codes.md), so the runtime
   may report that outcome without host cooperation.

## Decision

The abort listener now applies to every tool. For `Bash` and `GenerateImages` it
keeps sending `tools.abort` and waits a bounded grace window (10s) for the host
to return the output it collected before the kill. For every other tool it stops
waiting the moment the signal fires, without sending `tools.abort`, and the call
rejects with `TOOL_ABORTED`.

In both cases the wait is a `Promise.race` against the execute call. Losing the
race abandons the wait, not the host call: the orphaned `tools.execute` settles
on its own, its result is discarded, and the runtime never surfaces it.

The runtime also drives the tools from `abort()` itself, not only from the
signal each tool was handed. `abort()` walks the in-flight tool calls and runs
the same handler the signal would. Relying on the signal alone was not enough:
a stop can reach the runtime without reaching the tool, and then `abort()` stays
blocked on the turn settlement, which keeps the `agent.abort` RPC pending. The
renderer awaits that RPC before it clears "processing", so the session stayed
pinned even after the turn was over in the ledger. One field report showed
exactly that: three turns recorded `aborted` while the tool's process was still
alive minutes later.

## Consequences

- Stop always ends the turn, so a stuck tool can no longer block new turns,
  compaction, or session switching.
- A stop releases every in-flight tool, including one whose own abort signal
  never fired, so the stop RPC always returns and the renderer always leaves
  "processing".
- A non-cancellable tool keeps consuming host resources until it finishes. That
  is honest residual work, not a stuck UI, and it is why the durable fix stays
  with host-core: teach `tools.execute` an abort token so `Grep` and friends can
  actually be cancelled.
- Abandoning a call means the runtime can no longer observe its result. A retry
  must carry a fresh tool call id: reusing the abandoned id would race a second
  execution against the first and, for `Bash`, could pick up a cancellation
  tombstone meant for the abandoned call. This is also why non-cancellable tools
  do not send `tools.abort` — the RPC cannot help them, and the tombstone it
  leaves behind can only hurt.
- Progress output for an abandoned call stops at the moment of the stop.

## Alternatives

- **Send `tools.abort` for every tool.** Cancels pending approvals for
  non-cancellable tools, but leaves a 60s tombstone per aborted call that a
  later `Bash` could inherit. Rejected as a side effect with no benefit for the
  in-flight call.
- **Only arm a grace timer on abort (no race for cancellable tools).** Simpler,
  but leaves every non-cancellable tool waiting the full window and still keeps
  the turn blocked for that window.
- **Wait for host-core to grow cancellation for every tool.** Correct durable
  fix, tracked separately; it cannot ship as a bug fix for a turn that is stuck
  today.
