import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { IPC } from "@pi-desktop/shared";
import { remoteEn, remoteZh } from "../../apps/desktop/src/locales/remote";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { RemoteHostSessions } from "../../apps/desktop/src/components/settings/RemoteHostSessions";
import { RemoteHostsPage } from "../../apps/desktop/src/components/settings/RemoteHostsPage";
import { ChatSurface } from "../../apps/desktop/src/components/ChatSurface";
import { catalogs } from "@pi-desktop/i18n";
import { api } from "../../apps/desktop/src/lib/api";
import { subscribeRemoteInteractions } from "../../apps/desktop/src/lib/remote-interactions";

const host = { hostKey: "fixture", label: "Test Host", transport: "ssh", connected: true };
const capabilities = { canPrompt: true, canStop: true, canRefresh: true, canReadWorkspace: true, canConfigureModel: false, canAttach: false, canSteer: false, canEditMessages: false, canUseLocalTools: false, canUseTerminal: false };
const session = { id: "remote:fixture:one", source: "remote", remoteHostKey: "fixture", remoteHostLabel: "Test Host", remoteWorkspaceLabel: "Project", title: "Test session", messageCount: 0, mode: "agent", permissionMode: "ask", thinkingLevel: "inherit", capabilities, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const provider = { id: "fixture-provider", name: "Fixture provider", enabled: true, type: "native", vendorKey: "openai", protocol: "openai", authKind: "api_key", hasSecret: true, hasOauth: false, models: [{ id: "fixture-model" }] };
const calls = [];
const listeners = new Map();
let reconnects = 0;
window.piDesktop = {
  platform: "linux",
  on(channel, listener) {
    const group = listeners.get(channel) ?? new Set();
    group.add(listener); listeners.set(channel, group);
    return () => { group.delete(listener); if (!group.size) listeners.delete(channel); };
  },
  async invoke(channel, input) {
    calls.push({ channel, input });
    let data = {};
    if (channel === IPC.invoke.remoteHostList) data = { hosts: [host] };
    else if (channel === IPC.invoke.remoteHostPair) data = { host: { ...host, hostKey: "paired-fixture", label: input.label, url: input.url, transport: "direct" } };
    else if (channel === IPC.invoke.remoteHostProjects) data = { projects: [] };
    else if (channel === IPC.invoke.remoteHostSessions) data = { sessions: [session] };
    else if (channel === IPC.invoke.remoteHostSyncProviders) data = { imported: [{ sourceId: provider.id, providerId: "remote-provider" }], skipped: [], defaultSet: true };
    else if (channel === IPC.invoke.remoteHostRegisterProject) data = { project: { id: "project", label: "Project" } };
    else if (channel === IPC.invoke.remoteHostCreateSession) data = { session };
    else if (channel === IPC.invoke.sessionGet) data = { session: { ...session, messages: [] } };
    else if (channel === IPC.invoke.agentPrompt) {
      queueMicrotask(() => useAppStore.setState({ isRunning: false, runningSessions: {}, messages: [{ id: "remote-u1", role: "user", content: input.content, createdAt: Date.now() }] }));
      data = { accepted: true };
    }
    else if (channel === IPC.invoke.plansPending) data = { plans: [] };
    else if (channel === IPC.invoke.remoteHostReconnect) {
      if (++reconnects === 1) return { ok: false, error: { message: "Fixture reconnect failure", code: "AGENT_UNAVAILABLE" } };
      data = { host };
    }
    return { ok: true, data };
  },
};
function assert(condition, message) { if (!condition) throw new Error(message); }
function until(predicate, message) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!predicate()) return;
      observer.disconnect(); clearTimeout(timer); resolve();
    });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error(message)); }, 5000);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}
function button(text) { return [...document.querySelectorAll("button")].find(node => node.textContent.trim() === text); }
function input(label) { return [...document.querySelectorAll("input, textarea")].find(node => node.getAttribute("aria-label") === label); }
function checkbox(text) { return [...document.querySelectorAll("label")].find(node => node.textContent.includes(text))?.querySelector('input[type="checkbox"]'); }
function type(node, value) {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}
function emit(payload) { for (const listener of listeners.get(IPC.event.remoteInteractions) ?? []) listener(payload); }
function Fixture() {
  const active = useAppStore(state => state.activeSessionId);
  const current = useAppStore(state => state.sessions.find(item => item.id === active));
  return current ? <ChatSurface /> : <RemoteHostSessions host={host} onClose={() => {}} />;
}

globalThis.remoteMvpProbe = async () => {
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { remote: remoteEn, translation: catalogs.en },
      "zh-CN": { remote: remoteZh, translation: catalogs["zh-CN"] },
    },
    interpolation: { escapeValue: false },
  });
  useAppStore.setState({ sessions: [], activeSessionId: undefined, selectingSessionId: undefined, messages: [], retainedSessionIds: [], retainedTranscripts: {}, sessionHistory: {}, sessionMeta: {}, runningSessions: {}, pendingPlans: {}, pendingPermissions: {}, pendingAsks: {}, planningStates: {}, providers: [provider], workspace: { path: "/local/private", name: "Local only" }, activeProjectPath: "/local/private", page: "settings", settings: { defaultMode: "agent" } });
  const unsubscribe = subscribeRemoteInteractions();
  const root = createRoot(document.getElementById("root"));
  root.render(<Fixture />);
  await until(() => button(`${session.title} · ${session.remoteWorkspaceLabel}`) && !document.querySelector('[aria-busy="true"]'), "history never loaded");
  assert(!button(remoteEn.sync) && !button(remoteEn.create), "legacy history exposes remote model or project creation");
  assert(!calls.some(call => call.channel === IPC.invoke.remoteHostProjects || call.channel === IPC.invoke.remoteHostSyncProviders), "history fetched project or model state");
  button(`${session.title} · ${session.remoteWorkspaceLabel}`).click();
  await until(() => document.querySelector(".chat-surface"), "existing session did not open");
  assert(useAppStore.getState().workspace.path === "/local/private", "remote selection changed local workspace");
  const editor = document.querySelector(".composer-input");
  editor.textContent = "Inspect remote project";
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Inspect remote project" }));
  const send = () => document.querySelector('[aria-label="' + catalogs.en.chat.send + '"]');
  await until(() => send() && !send().disabled, "prompt input did not enable send");
  send().click();
  await until(() => calls.some(call => call.channel === IPC.invoke.agentPrompt) && document.querySelector(".composer-input").textContent === "", "send did not finish");
  const permission = { sessionId: session.id, requestId: `${session.id}#racp-approval:one`, toolCallId: "", toolName: "Bash", argsPreview: null, reason: "Run fixture command", risk: "medium" };
  emit({ kind: "snapshot", sessionId: session.id, permissions: [permission], asks: [] });
  await until(() => button(catalogs.en.permission.allowOnce) && !button(catalogs.en.permission.allowOnce).disabled, "approval was not ready");
  assert(document.querySelector(".permission-card").textContent.includes(permission.reason), "approval summary is not visible");
  button(catalogs.en.permission.allowOnce).click();
  await until(() => !document.querySelector(".permission-card"), "approval card did not clear");
  assert(calls.some(call => call.channel === IPC.invoke.toolResolvePermission && call.input.decision === "allow-once"), "approval was not routed");
  emit({ kind: "snapshot", sessionId: session.id, permissions: [permission], asks: [] });
  await until(() => document.querySelector(".permission-card"), "recovery card was not restored");
  emit({ kind: "resolved", sessionId: session.id, requestKind: "permission", requestId: permission.requestId });
  await until(() => !document.querySelector(".permission-card"), "peer resolution left a stale card");
  let reconnectFailed = false;
  try { await api.reconnectRemoteHost(host.hostKey); } catch { reconnectFailed = true; }
  assert(reconnectFailed, "reconnect failure was not observable");
  await api.reconnectRemoteHost(host.hostKey);
  assert(reconnects === 2, "reconnect retry did not recover");
  assert(calls.filter(call => call.channel === IPC.invoke.agentPrompt).length === 1, "reconnect replayed a prompt");
  assert(!calls.some(call => [IPC.invoke.projectActivate, IPC.invoke.sessionConfigure].includes(call.channel)), "remote UI called a local workspace/model operation");
  root.unmount(); unsubscribe();
  assert(listeners.size === 0, "component listeners leaked");

  const settingsRoot = createRoot(document.getElementById("root"));
  settingsRoot.render(<RemoteHostsPage />);
  await until(() => document.querySelector(".settings-remote-host-list")?.getAttribute("aria-busy") === "false", "remote hosts did not load");
  const addShell = document.querySelector(".settings-remote-host-add-shell");
  const sshAction = document.getElementById("remote-host-add-ssh");
  const pairAction = document.getElementById("remote-host-add-pair");
  const sshPanel = document.getElementById("remote-host-add-panel-ssh");
  const pairPanel = document.getElementById("remote-host-add-panel-pair");
  assert(addShell?.hidden && sshAction && pairAction && sshPanel && pairPanel, "add actions or initially collapsed forms are missing");

  sshAction.click();
  await until(() => !sshPanel.hidden, "SSH action did not reveal its form");
  assert(sshAction.getAttribute("aria-expanded") === "true" && pairPanel.hidden, "SSH form state is not exposed correctly");
  pairAction.click();
  await until(() => !addShell.hidden && !pairPanel.hidden, "Pair action did not reveal its form");
  assert(pairAction.getAttribute("aria-expanded") === "true" && sshPanel.hidden, "Pair form did not replace SSH form");

  const pairLabel = [...pairPanel.querySelectorAll("input")].find(field => field.getAttribute("aria-label") === catalogs.en.settings.remoteHosts.fieldLabel);
  const pairUrl = [...pairPanel.querySelectorAll("input")].find(field => field.getAttribute("aria-label") === catalogs.en.settings.remoteHosts.fieldUrl);
  const pairToken = [...pairPanel.querySelectorAll("input")].find(field => field.getAttribute("aria-label") === catalogs.en.settings.remoteHosts.fieldPairingToken);
  assert(pairLabel && pairUrl && pairToken, "Pair form fields are missing");
  type(pairLabel, "Fixture host");
  type(pairUrl, "ws://127.0.0.1:4000");
  type(pairToken, "ppt1.fixture-token");
  pairPanel.querySelector('button[type="submit"]').click();
  await until(() => addShell.hidden && calls.some(call => call.channel === IPC.invoke.remoteHostPair), "successful pairing did not close the form");
  assert(pairAction.getAttribute("aria-expanded") === "false", "Pair action remained expanded after success");
  await i18n.changeLanguage("zh-CN");
  const localizedPairAction = catalogs["zh-CN"].settings.remoteHosts.addPair;
  await until(
    () => pairAction.textContent.trim() === localizedPairAction,
    `Pair action did not localize in ${i18n.language}: ${pairAction.textContent.trim()}`,
  );
  assert(pairAction.getAttribute("aria-controls") === "remote-host-add-panel-pair", "Pair association changed with locale");

  pairAction.click();
  await until(() => !pairPanel.hidden, "Pair form did not reopen");
  assert(pairLabel.value === "", "successful pairing retained the previous draft");
  type(pairLabel, "Discarded draft");
  pairPanel.querySelector('.settings-remote-host-form-actions button[type="button"]').click();
  await until(() => addShell.hidden, "Cancel did not close the Pair form");
  pairAction.click();
  await until(() => !pairPanel.hidden, "Pair form did not reopen after cancel");
  assert(pairLabel.value === "", "Cancel retained the previous draft");
  sshAction.click();
  await until(() => !sshPanel.hidden, "SSH action did not switch back to its form");
  const passwordModeLabel = catalogs["zh-CN"].settings.remoteHosts.sshAuthPassword;
  const passwordLabel = catalogs["zh-CN"].settings.remoteHosts.sshPassword;
  const passwordModeAction = () => [...sshPanel.querySelectorAll("button")]
    .find(action => action.textContent.trim() === passwordModeLabel);
  const sshPasswordInput = () => [...sshPanel.querySelectorAll("input")]
    .find(field => field.getAttribute("aria-label") === passwordLabel);
  sshAction.click();
  await until(() => !sshPanel.hidden, "SSH action did not reveal its form");
  await until(() => passwordModeAction(), "SSH password mode was missing");
  passwordModeAction().click();
  await until(() => sshPasswordInput(), "SSH password field did not appear");
  type(sshPasswordInput(), "temporary-fixture-password");
  sshPanel.querySelector('.settings-remote-host-form-actions button[type="button"]').click();
  await until(() => addShell.hidden, "Cancel did not close the SSH form");
  sshAction.click();
  await until(() => !sshPanel.hidden, "SSH form did not reopen after cancel");
  passwordModeAction().click();
  await until(() => sshPasswordInput(), "SSH password field did not reopen");
  assert(sshPasswordInput().value === "", "Cancel retained the SSH password draft");
  sshPanel.querySelector('.settings-remote-host-form-actions button[type="button"]').click();
  await until(() => addShell.hidden, "Cancel did not close the SSH form");
  settingsRoot.unmount();
  assert(listeners.size === 0, "remote hosts page listeners leaked");
  return { ok: true, scenarios: ["history without model transfer", "open", "send", "approve", "peer resolution", "reconnect without replay", "local isolation", "host Add actions reveal one form", "pair success and cancel clear drafts", "SSH password draft clears on cancel", "cleanup"] };
};
