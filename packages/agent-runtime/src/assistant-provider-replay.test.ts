import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { CommandShellOption, UiMessage } from "@pi-desktop/shared";

import {
  captureAssistantProviderReplay,
  restoreAssistantProviderReplay,
} from "./assistant-provider-replay.js";
import { assistantContent } from "./agent-messages.js";
import { DesktopAgentRuntime, type RuntimeProviderConfig } from "./runtime.js";

/**
 * A rebuilt runtime replays persisted rows. Without the provider signatures,
 * pi-ai sends Anthropic thinking as plain text and drops Responses reasoning
 * items, which rewrites the request prefix and loses the prompt cache (#1972).
 */

const signedContent: AssistantMessage["content"] = [
  { type: "thinking", thinking: "plan A", thinkingSignature: "sig-1" },
  { type: "thinking", thinking: "", thinkingSignature: "opaque", redacted: true },
  { type: "text", text: "Hello ", textSignature: "msg-1" },
  { type: "thinking", thinking: "plan B", thinkingSignature: "sig-2" },
  { type: "text", text: "world" },
];

describe("assistant provider replay", () => {
  it("restores the exact signed blocks from the persisted text", () => {
    const replay = captureAssistantProviderReplay(signedContent);
    const { text, thinking } = assistantContent(signedContent);
    // The row keeps boundaries and signatures only, never the texts.
    expect(JSON.stringify(replay)).not.toContain("plan A");
    expect(restoreAssistantProviderReplay(replay, thinking, text)).toEqual([
      { type: "thinking", thinking: "plan A", thinkingSignature: "sig-1" },
      { type: "thinking", thinking: "", thinkingSignature: "opaque", redacted: true },
      { type: "text", text: "Hello ", textSignature: "msg-1" },
      { type: "thinking", thinking: "plan B", thinkingSignature: "sig-2" },
      { type: "text", text: "world" },
    ]);
  });

  it("records nothing when no block carries a signature", () => {
    expect(
      captureAssistantProviderReplay([
        { type: "thinking", thinking: "plain" },
        { type: "text", text: "answer" },
      ]),
    ).toBeUndefined();
    expect(captureAssistantProviderReplay("text only")).toBeUndefined();
  });

  it("falls back when the stored lengths no longer match the row", () => {
    const replay = captureAssistantProviderReplay(signedContent);
    expect(restoreAssistantProviderReplay(replay, "plan Aplan B", "Hello world!")).toBeUndefined();
    expect(restoreAssistantProviderReplay(replay, "edited", "Hello world")).toBeUndefined();
    expect(restoreAssistantProviderReplay(undefined, "", "")).toBeUndefined();
    expect(restoreAssistantProviderReplay({ version: 2, blocks: [] }, "", "")).toBeUndefined();
    expect(
      restoreAssistantProviderReplay(
        { version: 1, blocks: [{ type: "text", length: -1 }] },
        "",
        "",
      ),
    ).toBeUndefined();
  });
});

const commandShell: CommandShellOption = {
  id: "bash",
  label: "Bash",
  dialect: "posix",
  available: true,
  isDefault: true,
};

const responsesProvider: RuntimeProviderConfig = {
  id: "relay",
  name: "Relay",
  baseUrl: "https://relay.example.com/v1",
  modelId: "gpt-test",
  apiKey: "sk-test",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "medium"],
  modelConfig: {
    source: "generic",
    api: "responses",
    name: "GPT Test",
    baseUrl: "https://relay.example.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
};

const reasoningItem = {
  type: "reasoning",
  id: "rs_1",
  summary: [{ type: "summary_text", text: "think" }],
  encrypted_content: "enc-1",
};

function historyRow(overrides: Partial<UiMessage> = {}): UiMessage[] {
  const live: AssistantMessage["content"] = [
    { type: "thinking", thinking: "think", thinkingSignature: JSON.stringify(reasoningItem) },
    {
      type: "text",
      text: "answer",
      textSignature: JSON.stringify({ v: 1, id: "msg_real_1" }),
    },
  ];
  return [
    { id: "u1", role: "user", content: "question", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "a1",
      role: "assistant",
      content: "answer",
      thinking: "think",
      createdAt: "2026-01-01T00:00:01.000Z",
      status: "complete",
      providerReplay: captureAssistantProviderReplay(live),
      ...overrides,
    },
  ];
}

function createRuntime(history: UiMessage[], onEvent = vi.fn()) {
  return new DesktopAgentRuntime({
    host: {
      call: vi.fn(async () => ({})),
      onNotification: vi.fn(() => () => {}),
    } as never,
    sessionId: "session-1",
    mode: "agent",
    provider: responsesProvider,
    thinkingLevel: "medium",
    commandShell,
    history,
    onEvent,
  });
}

async function firstRequestInput(history: UiMessage[]): Promise<unknown[]> {
  const runtime = createRuntime(history);
  const internals = runtime as unknown as {
    agent: Agent;
    model: Model<Api>;
    fullEntries: { message: unknown }[];
  };
  const bodies: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ error: { message: "fixture" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };
  const messages = [
    ...internals.fullEntries.map((entry) => entry.message),
    { role: "user", content: "next", timestamp: 2 },
  ];
  const stream = await internals.agent.streamFunction(
    internals.model,
    { messages } as never,
    { apiKey: "sk-test", fetch },
  );
  // The fixture fails the request; only the captured body is under test.
  await stream.result().catch(() => undefined);
  await runtime.dispose();
  expect(bodies).toHaveLength(1);
  return bodies[0].input as unknown[];
}

describe("rebuilt runtime request", () => {
  it("replays the persisted reasoning item and message id", async () => {
    const input = await firstRequestInput(historyRow());
    expect(input).toContainEqual(expect.objectContaining({ type: "reasoning", id: "rs_1", encrypted_content: "enc-1" }));
    expect(input).toContainEqual(expect.objectContaining({ type: "message", role: "assistant", id: "msg_real_1" }));
  });

  it("keeps the previous rebuild for rows without replay data", async () => {
    const input = await firstRequestInput(historyRow({ providerReplay: undefined }));
    expect(input.some((item) => (item as { type?: string }).type === "reasoning")).toBe(false);
    expect(input).toContainEqual(expect.objectContaining({ type: "message", role: "assistant", id: "msg_pi_1" }));
  });
});

describe("live response to rebuilt request", () => {
  it("persists the replay data a later runtime needs", async () => {
    const onEvent = vi.fn();
    const live = createRuntime([], onEvent);
    const handleAgentEvent = (live as unknown as {
      handleAgentEvent: (event: unknown) => Promise<void>;
    }).handleAgentEvent.bind(live);
    const message = {
      role: "assistant",
      content: [] as AssistantMessage["content"],
      api: "openai-responses",
      provider: "relay",
      model: "gpt-test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1,
    };
    await handleAgentEvent({ type: "message_start", message });
    await handleAgentEvent({
      type: "message_end",
      message: {
        ...message,
        content: [
          { type: "thinking", thinking: "think", thinkingSignature: JSON.stringify(reasoningItem) },
          { type: "text", text: "answer", textSignature: JSON.stringify({ v: 1, id: "msg_real_1" }) },
        ],
      },
    });
    await live.dispose();

    const ended = onEvent.mock.calls
      .map(([envelope]) => (envelope as { event: { type: string; message?: UiMessage } }).event)
      .find((event) => event.type === "message_end" && event.message?.role === "assistant");
    expect(ended?.message?.providerReplay).toBeDefined();

    // What the host stores is JSON; restore from that, not the live object.
    const persisted = JSON.parse(JSON.stringify(ended?.message)) as UiMessage;
    const input = await firstRequestInput([
      { id: "u1", role: "user", content: "question", createdAt: "2026-01-01T00:00:00.000Z" },
      persisted,
    ]);
    expect(input).toContainEqual(expect.objectContaining({ type: "reasoning", encrypted_content: "enc-1" }));
    expect(input).toContainEqual(expect.objectContaining({ type: "message", role: "assistant", id: "msg_real_1" }));
  });
});
