import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(
  new URL("../src/components/SidebarMenuPanel.tsx", import.meta.url),
  "utf8",
);

test("the panel renders every item kind with its own accessible role", () => {
  assert.match(panelSource, /role="menuitem"[\s\S]*?data-action=\{item\.id\}/);
  assert.match(panelSource, /role="menuitemradio"/);
  assert.match(panelSource, /role="menuitemcheckbox"/);
  assert.match(panelSource, /assert|aria-checked=\{item\.checked\}|aria-checked=\{option\.selected\}/);
  assert.match(panelSource, /className="sidebar-menu-separator"|role="separator"/);
  assert.match(panelSource, /className="sidebar-menu-section"/);
  assert.match(panelSource, /className="sidebar-menu-hint"/);
  assert.match(panelSource, /className="sidebar-menu-note"/);
  /* A caption is a label, not a row: it must never become a menuitem. */
  assert.doesNotMatch(panelSource, /<button[^>]*data-sidebar-menu-section/);
  assert.match(panelSource, /aria-label=\{content\.label\}/);
});

test("keyboard navigation walks the rows the menu can actually run", () => {
  assert.match(
    panelSource,
    /\[role="menuitem"\]:not\(:disabled\), \[role="menuitemradio"\]:not\(:disabled\), \[role="menuitemcheckbox"\]:not\(:disabled\)/,
  );
  assert.match(panelSource, /ArrowDown/);
  assert.match(panelSource, /ArrowUp/);
  assert.match(panelSource, /Home/);
  assert.match(panelSource, /End/);
  assert.match(panelSource, /event\.key === "Escape"[\s\S]*?onClose\(\)/);
});

test("a lone uncaptioned option joins the rows instead of heading its own group", () => {
  assert.match(
    panelSource,
    /group\.label \|\| group\.options\.length > 1/,
    "a single option without a caption must not render a group header",
  );
});

/*
  The new menu vocabulary is product copy, so every shipped locale carries it;
  a missing key would silently fall back to English.
*/
test("every locale ships the sidebar menu keys", async () => {
  const { catalogs } = await import("@pi-desktop/i18n");
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const nav = catalog.nav ?? {};
    assert.equal(typeof nav.dangerZone, "string", `${locale}: nav.dangerZone`);
    assert.equal(typeof nav.viewOptions, "string", `${locale}: nav.viewOptions`);
    assert.equal(typeof nav.batchSelectionHint, "string", `${locale}: nav.batchSelectionHint`);
    assert.equal(
      typeof catalog.worktree?.menu?.group,
      "string",
      `${locale}: worktree.menu.group`,
    );
  }
});
