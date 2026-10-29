import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { capabilityQuery } = await import("../src/lib/capability-scope.ts");

test("a global capability query stays scope-free even with a project selected", () => {
  // #1957 regression: with project A selected and a legacy per-project
  // override underneath (the old UI wrote those), the switch must still write
  // the global default. A query carrying projectPath here would write an
  // override instead - a no-op click that reverted on the next refresh and
  // left the global default unreachable from any project.
  assert.deepEqual(capabilityQuery("global", "/projects/a"), { level: "global" });
  assert.deepEqual(capabilityQuery("global", null), { level: "global" });
});

test("a project capability query carries the selected project's path", () => {
  // The host resolves a project definition by scanning that project's
  // directory, so without the path the row cannot be found at all.
  assert.deepEqual(capabilityQuery("project", "/projects/a"), {
    level: "project",
    projectPath: "/projects/a",
  });
  // No selection, no path to attach.
  assert.deepEqual(capabilityQuery("project", null), { level: "project" });
});
