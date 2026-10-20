import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

// The real persistence pass, driven directly with a stubbed outbox.
const { createSessionCoordination } = await import(
  "../electron/main/runtime/session-coordination.ts"
);
const { createEventPersistence } = await import(
  "../electron/main/runtime/event-persistence.ts"
);

const SESSION = "s1";
const TURN = "turn-1";

function fixture() {
  const activeTurns = new Map([[SESSION, TURN]]);
  const coordination = createSessionCoordination({
    activeTurns,
    getMainWindow: () => null,
    getViewingSessionId: () => null,
  });
  const enqueued = [];
  const steeringReplies = new Set();
  const persistence = createEventPersistence({
    runtimeState: { host: null },
    steeringReplies,
    activeTurns,
    activeToolCalls: new Map(),
    activeToolCallKey: coordination.activeToolCallKey,
    approvedExecutionIdsBySession: new Map(),
    approvedExecutionTurns: new Map(),
    pendingExecutionFinishes: new Map(),
    planSubmissionTurnIds: new Set(),
    planSubmissionTurnKey: coordination.planSubmissionTurnKey,
    inflightCheckpointer: {
      observe() {},
      flush: async () => {},
      settle() {},
      settleIf() {},
    },
    persistenceOutbox: {
      size: () => 0,
      enqueue: async (entry) => {
        enqueued.push(entry);
      },
      flush: async () => undefined,
    },
    addActiveTurnUsage() {},
    logger: { app() {} },
    finishTurn: () => Promise.resolve(),
    isStaleTerminalEvent: coordination.isStaleTerminalEvent,
    transcriptRewrite: coordination,
    finishApprovedExecution: async () => undefined,
    emitAgentEvent() {},
  });
  const persistAssistant = (message) =>
    persistence.persistAgentEvent({
      sessionId: SESSION,
      turnId: TURN,
      ts: 1,
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          createdAt: "2026-10-20T00:00:00.000Z",
          ...message,
        },
      },
    });
  return { enqueued, steeringReplies, persistAssistant };
}

test("an empty complete assistant message is not persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "m1", content: "", thinking: "", status: "complete" });
  assert.equal(f.enqueued.length, 0);
});

test("an empty aborted assistant message without an error is not persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "m2", content: "", thinking: "", status: "aborted" });
  assert.equal(f.enqueued.length, 0);
});

test("an empty assistant message that still carries a tool row is persisted", () => {
  const f = fixture();
  f.persistAssistant({
    id: "m3",
    content: "",
    thinking: "",
    status: "complete",
    toolName: "Grep",
    toolCallId: "call-1",
    toolStatus: "success",
  });
  assert.equal(f.enqueued.length, 1);
});

test("an empty assistant message with an error payload stays durable", () => {
  const f = fixture();
  f.persistAssistant({
    id: "m4",
    content: "",
    thinking: "",
    status: "error",
    error: { code: "PROVIDER_ERROR", message: "boom" },
  });
  assert.equal(f.enqueued.length, 1);
});

test("an empty assistant message reserved for steering is persisted", () => {
  const f = fixture();
  f.steeringReplies.add("m5");
  f.persistAssistant({ id: "m5", content: "", thinking: "", status: "complete" });
  assert.equal(f.enqueued.length, 1);
});

test("a non-empty complete assistant message is persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "m6", content: "done", status: "complete" });
  assert.equal(f.enqueued.length, 1);
});
