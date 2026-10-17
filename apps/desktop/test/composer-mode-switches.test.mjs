import assert from "node:assert/strict";
import test from "node:test";
import { composerToolbar } from "./helpers/composer-toolbar.mjs";
import { readComposerModule } from "./helpers/source-contracts.mjs";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/*
 * The Composer execution switches replaced two multi-step controls: a mode chip
 * that cycled Agent -> Plan -> Goal on each click, and an approval chip that hid
 * its three levels behind a menu. Both are now inline radiogroups where every
 * option is one click away, and the committed pair is readable at rest.
 */

const switchesSource = await readComposerModule("ComposerSwitches.tsx");

async function toolbar(t, overrides = {}) {
  const ssr = await slotSsr(t);
  return (await composerToolbar(t, ssr, overrides))();
}

/** Radios of one labelled group, in render order. */
function radios(html, groupLabel) {
  const start = html.indexOf(`aria-label="${groupLabel}`);
  assert.ok(start >= 0, `missing group: ${groupLabel}`);
  const group = html.slice(start, html.indexOf("</div>", start));
  return [...group.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map(([tag]) => ({
    label: tag.match(/aria-label="([^"]*)"/)?.[1],
    checked: /aria-checked="true"/.test(tag),
    active: /composer-segment is-active/.test(tag),
  }));
}

test("mode and approval render as two labelled radiogroups, not menus", async (t) => {
  const html = await toolbar(t, { mode: "plan", composerPermissionMode: "accept-edits" });
  assert.match(html, /role="radiogroup" aria-label="settings\.mode"/);
  assert.match(html, /role="radiogroup" aria-label="chat\.permissionMode"/);
  // Only the cluster itself: the model picker on the right still opens a menu.
  const cluster = html.slice(
    html.indexOf("composer-switches"),
    html.indexOf('<div class="composer-right">'),
  );
  assert.ok(cluster.length > 0);
  assert.doesNotMatch(cluster, /aria-haspopup|role="menu"/);

  const modes = radios(html, "settings.mode");
  assert.deepEqual(
    modes.map((radio) => radio.label),
    ["settings.modeAgent", "settings.modePlan", "settings.modeGoal"],
  );
  assert.deepEqual(modes.map((radio) => radio.checked), [false, true, false]);
  assert.deepEqual(modes.map((radio) => radio.active), [false, true, false]);

  const approvals = radios(html, "chat.permissionMode");
  assert.deepEqual(
    approvals.map((radio) => radio.label),
    ["chat.permissionAsk", "chat.permissionAcceptEdits", "chat.permissionAuto"],
  );
  // Plain markup is escaped in the attribute, so match the checked flags only.
  assert.deepEqual(approvals.map((radio) => radio.checked), [false, true, false]);
});

test("each option commits on a single click", async (t) => {
  const html = await toolbar(t, { mode: "agent", composerPermissionMode: "ask" });
  // Every option is rendered as its own target; nothing is hidden behind a
  // second surface, and no chip advances to "the next" state.
  assert.equal(radios(html, "settings.mode").length, 3);
  assert.equal(radios(html, "chat.permissionMode").length, 3);
  assert.match(
    switchesSource,
    /onClick=\{\(\) => \{\s*\n\s*if \(!active\) onSelect\(segment\.value\);/,
  );
  assert.doesNotMatch(switchesSource, /nextMode|AnchoredMenu|role="menu"/);
});

test("arrow keys move to the neighbouring option and commit it", () => {
  assert.match(
    switchesSource,
    /const SELECT_KEYS = new Set\(\["ArrowLeft", "ArrowRight", "Home", "End"\]\)/,
  );
  assert.match(switchesSource, /role="radiogroup"[\s\S]*?onKeyDown=\{handleKeyDown\}/);
  // Selection follows focus, exactly like a native radio group.
  assert.match(switchesSource, /target\.focus\(\);[\s\S]*?target\.click\(\);/);
  // Roving tabindex keeps one tab stop per group.
  assert.match(switchesSource, /tabIndex=\{active \? 0 : -1\}/);
});

test("Goal locks the approval switch to Auto and says why", async (t) => {
  const html = await toolbar(t, { mode: "goal", composerPermissionMode: "ask" });
  const start = html.indexOf('aria-label="chat.permissionMode');
  const group = html.slice(start, html.indexOf("</div>", start));
  // Every approval option is disabled, Auto is the checked one, and the group
  // still names the locked state for assistive technology.
  assert.equal([...group.matchAll(/<button[^>]*role="radio"[^>]*>/g)].length, 3);
  for (const [tag] of group.matchAll(/<button[^>]*role="radio"[^>]*>/g)) {
    assert.match(tag, /disabled=""/);
  }
  const approvals = radios(html, "chat.permissionMode");
  assert.deepEqual(approvals.map((radio) => radio.checked), [false, false, true]);
  assert.match(html, /aria-label="chat\.permissionMode · /);
});

test("the switches stay in flow while the toolbar narrows", async () => {
  const { loadStyles } = await import("./helpers/styles.mjs");
  const styles = await loadStyles();
  // The committed option keeps its label the longest, so the current pair is
  // readable at every toolbar width; the others collapse to their glyphs.
  assert.match(
    styles,
    /\.composer-segment:not\(\.is-active\) \.composer-segment-label\s*\{\s*display:\s*none;/,
  );
  assert.match(
    styles,
    /@container composer-stack \(max-width: 450px\)[\s\S]*?\.composer-segment-label\s*\{\s*display:\s*none;/,
  );
  assert.match(styles, /\.composer-switches\s*\{[\s\S]*?background:\s*var\(--ds-tile\);/);
});
