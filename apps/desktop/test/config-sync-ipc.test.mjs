import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { IPC } from "@pi-desktop/shared";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { registerConfigSyncIpc } = await import("../electron/main/ipc/config-sync-ipc.ts");

test("history and probe results never masquerade as configuration state events", async () => {
  const handlers = new Map();
  const events = [];
  const calls = [];
  const state = { configured: true, mode: "backup", pendingApprovals: [] };
  const history = [{ revisionId: "revision-a", current: true }];
  registerConfigSyncIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({ async call(method, input) {
      calls.push([method, input]);
      if (method === "configSync.listHistory") return history;
      if (method === "configSync.test") return { ok: true, conditionalWrites: true };
      return state;
    } }),
    sendToRenderer: (channel, value) => events.push([channel, value]),
  });
  assert.deepEqual(await handlers.get(IPC.invoke.configSyncListHistory)(), history);
  assert.deepEqual(await handlers.get(IPC.invoke.configSyncTest)({ bucket: "private" }), { ok: true, conditionalWrites: true });
  assert.deepEqual(events, []);
  assert.equal(await handlers.get(IPC.invoke.configSyncConfigure)({ mode: "backup" }), state);
  assert.deepEqual(events, [[IPC.event.configSyncChanged, state]]);
  assert.deepEqual(calls.at(-1), ["configSync.configure", { mode: "backup" }]);
});
