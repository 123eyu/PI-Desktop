/**
 * Settings ▸ Remote Hosts page contract.
 *
 * Guards the compact inventory + on-demand Add (SSH/Pair) forms: no
 * instructional copy, both forms are hidden until selected, and the
 * destination is marked Experimental on the rail and page title.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadStylesSync } from "./helpers/styles.mjs";
import { readSettingsSourceSync } from "./helpers/source-contracts.mjs";

const page = readFileSync(
  new URL("../src/components/settings/RemoteHostsPage.tsx", import.meta.url),
  "utf8",
);
const settingsNav = readFileSync(
  new URL("../src/lib/settings-search.ts", import.meta.url),
  "utf8",
);
const settings = readSettingsSourceSync();
const styles = loadStylesSync();

function cssRule(selector) {
  const from = styles.indexOf(`\n${selector} {`);
  assert.ok(from >= 0, `${selector} rule missing`);
  return styles.slice(from, styles.indexOf("}", from));
}

test("remote hosts keeps Add actions visible and reveals one form on demand", () => {
  assert.match(page, /useState<AddMode \| null>\(null\)/);
  assert.doesNotMatch(page, /role="tablist"/);
  for (const mode of ["ssh", "pair"]) {
    assert.ok(page.includes(`id="remote-host-add-${mode}"`));
    assert.ok(page.includes(`aria-expanded={addMode === "${mode}"}`));
    assert.ok(page.includes(`aria-controls="remote-host-add-panel-${mode}"`));
    assert.ok(page.includes(`onClick={() => setAddMode("${mode}")}`));
    assert.ok(page.includes(`id="remote-host-add-panel-${mode}"`));
    assert.ok(page.includes(`hidden={addMode !== "${mode}"}`));
  }
  assert.match(page, /className="settings-panel settings-remote-host-add-shell"\s+hidden=\{addMode === null\}/);
  assert.match(page, /onClick=\{closeAddForm\}/);
  assert.match(page, /setSshForm\(EMPTY_SSH_FORM\)/);
  assert.match(page, /api\.bootstrapRemoteHost\(/);
  assert.match(page, /api\.pairRemoteHost\(/);
  assert.match(page, /api\.listRemoteHosts\(/);
  assert.match(page, /api\.removeRemoteHost\(/);

  assert.match(cssRule(".settings-remote-host-add-shell[hidden]"), /display:\s*none/);
  assert.match(cssRule(".settings-remote-host-add-panel[hidden]"), /display:\s*none/);
  assert.match(cssRule(".settings-remote-host-card"), /background:\s*var\(--ds-tile\)/);
  assert.match(cssRule(".settings-remote-host-name"), /font-size:\s*var\(--text-md-plus\)/);
});

test("remote hosts omits instructional copy", () => {
  assert.doesNotMatch(page, /role="note"/);
  assert.doesNotMatch(page, /settings-row-desc/);
  assert.doesNotMatch(page, /hint=\{/);
  assert.doesNotMatch(page, /settings\.remoteHosts\.(overview|sshBody|pairBody|emptyBody)/);
  assert.doesNotMatch(page, /<SettingsCard title=\{t\("settings\.remoteHosts\.listTitle"\)\}/);
});

test("the remote-hosts destination is marked experimental", () => {
  assert.match(
    settingsNav,
    /\{\s*id: "remoteHosts",[\s\S]*?experimentalBadgeKey: "settings\.remoteHosts\.experimental",/,
  );
  assert.match(settings, /item\.experimentalBadgeKey \? \(/);
  assert.match(settings, /activeNavItem\?\.experimentalBadgeKey \? \(/);
  assert.match(settings, /className="settings-nav-experimental"/);
  assert.match(cssRule(".settings-nav-experimental"), /font-size:\s*var\(--text-2xs\)/);
  assert.doesNotMatch(page, /EXPERIMENTAL_FEATURES/);
  assert.doesNotMatch(page, /experimentalLan/);
  assert.doesNotMatch(page, /experimentalGateway/);
  assert.doesNotMatch(page, /SettingsCard/);
});

test("remote host inventory renders non-binary connection states with localized labels", () => {
  assert.match(page, /statusConnecting/);
  assert.match(page, /statusReconnecting/);
  assert.match(page, /statusActionRequired/);
  assert.match(page, /statusOffline/);
});
