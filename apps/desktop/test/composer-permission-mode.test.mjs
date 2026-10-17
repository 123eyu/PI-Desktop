import { readComposerSource, readComposerModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { loadStyles } from "./helpers/styles.mjs";
import test from "node:test";

const composerSource = await readComposerSource();
const switchesSource = await readComposerModule("ComposerSwitches.tsx");
const styles = await loadStyles();

test("Agent and Plan offer the effective approval levels as one-click options", () => {
  // The three selectable levels are rendered from one ordered list, and every
  // option is a radio the user reaches in a single action.
  assert.match(
    switchesSource,
    /const SELECTABLE_PERMISSIONS: readonly SelectablePermission\[\] = \[[\s\S]*?"ask",[\s\S]*?"accept-edits",[\s\S]*?"auto",[\s\S]*?\];/,
  );
  assert.match(switchesSource, /role="radiogroup"/);
  assert.match(switchesSource, /role="radio"/);
  assert.match(switchesSource, /aria-checked=\{active\}/);
  assert.match(switchesSource, /aria-label=\{segment\.label\}/);
  assert.match(
    switchesSource,
    /label: t\(PERMISSION_MODE_I18N_KEYS\[candidate\]\)/,
  );
  // `inherit` is a task-draft default, never a Composer option.
  assert.doesNotMatch(switchesSource, /PERMISSION_MODE_I18N_KEYS\["inherit"\]/);
});

test("Goal keeps the approval switch visible but fixed to Full auto", () => {
  assert.match(
    composerSource,
    /const composerPermissionMode: Exclude<PermissionMode, "inherit"> =\s*\n\s*mode === "goal" \? "auto" : effectivePermissionMode;/,
  );
  assert.match(switchesSource, /locked=\{mode === "goal"\}/);
  assert.match(
    switchesSource,
    /const effectivePermission: SelectablePermission = locked\s*\n?\s*\? "auto"/,
  );
  assert.match(switchesSource, /disabled=\{controlsBlocked \|\| locked\}/);
  // The locked group states why it cannot be changed instead of silently
  // ignoring clicks.
  assert.match(switchesSource, /`\$\{t\("chat\.permissionMode"\)\} · \$\{t\("goal\.autoWarning"\)\}`/);
});

test("approval selection commits through the active-session configuration path", () => {
  const toolbar = composerSource.slice(
    composerSource.indexOf("<ComposerSwitches"),
    composerSource.indexOf("<ComposerControlSlots side=\"left\" />"),
  );
  assert.match(toolbar, /onSelectPermission=\{async \(candidate\) => \{/);
  assert.match(toolbar, /permissionMode: candidate,/);
  assert.match(toolbar, /onSelectMode=\{async \(next\) => \{/);
  assert.match(toolbar, /mode: next,/);
  // The old permission chip opened a menu; nothing may reintroduce it.
  assert.doesNotMatch(styles, /\.composer-permission-menu\s*\{/);
  assert.doesNotMatch(composerSource, /composer-permission-menu/);
});
