#!/usr/bin/env node
// Real transcript clicks, Rust storage, preload IPC and native HTML guests.
// No provider requests: seed only synthetic messages in an isolated profile.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";
import { startHtmlPreviewModel } from "./e2e/html-preview-model.mjs";

const root = repositoryRoot();
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT || "playwright");
const output = await mkdtemp(join(process.env.PI_TEST_OUTPUT || tmpdir(), "pi-html-links-"));
const data = join(output, "data"), primary = join(output, "project"), secondary = join(output, "assets");
await Promise.all([data, primary, secondary].map(path => mkdir(path, { recursive: true })));
const binary = resolveHostBinary();
const host = new Host(binary, data, { quiet: true });
const model = await startHtmlPreviewModel();
const cases = [];
let outside;
const html = '<!doctype html><meta charset="utf-8"><title>Pelican animation</title><style>body{background:#f5f5f5;color:#222;font:20px system-ui;padding:28px}svg{width:240px}circle{animation:ride 2s infinite alternate}@keyframes ride{to{transform:translateX(80px)}}</style><h1>Pelican bicycle animation</h1><svg viewBox="0 0 240 80"><circle cx="40" cy="40" r="24" fill="#222"/></svg><p id="result">Ready</p><button onclick="document.querySelector(\'#result\').textContent=\'Animation opened\'">Run animation</button>';
try {
  await host.start();
  const { provider } = await host.call("providers.create", {
    name: "HTML local fixture", vendorKey: "custom", type: "openai_compatible",
    protocol: "openai_compatible", baseUrl: model.baseUrl, authKind: "none",
    defaultModelId: "html-fixture", apiStyle: "chat_completions",
  });
  await host.call("settings.set", { language: "en", theme: "dark", developerMode: true,
    defaultProviderId: provider.id, defaultModelId: "html-fixture",
    defaultMode: "agent", defaultPermissionMode: "auto" });
  const plain = (await host.call("session.create", { title: "HTML ordinary conversation" })).session;
  await host.call("project.group.create", { name: "HTML project", folders: [primary, secondary] });
  await host.call("workspace.set", { path: primary });
  const project = (await host.call("session.create", { title: "HTML project conversation", projectPath: primary })).session;
  for (const [session, dir, label, spelling] of [
    [plain, join(data, "scratch", plain.id), "Ordinary scratch", "relative"],
    [project, primary, "Project primary", "relative"],
    [project, secondary, "Project secondary", "absolute"],
    [project, join(data, "scratch", project.id), "Project scratch", "absolute"],
    [plain, join(data, "scratch", plain.id), "File URL Unicode", "url"],
  ]) {
    await mkdir(dir, { recursive: true });
    const name = spelling === "url" ? "鹈鹕 animation.html" : label.replaceAll(" ", "-") + ".html";
    const file = join(dir, name);
    await writeFile(file, html);
    const href = spelling === "relative" ? name : spelling === "url" ? pathToFileURL(file).href : file.replaceAll("\\", "/");
    await host.call("session.appendMessage", { sessionId: session.id, message: {
      id: randomUUID(), role: "user", content: "Create " + label,
      status: "complete", createdAt: new Date().toISOString(),
    } });
    await host.call("session.appendMessage", { sessionId: session.id, message: {
      id: randomUUID(), role: "assistant", content: "[" + label + "](<" + href + ">)",
      status: "complete", createdAt: new Date().toISOString(),
    } });
    cases.push({ sessionId: session.id, label, file });
  }
  await host.call("session.appendMessage", { sessionId: plain.id, message: {
    id: randomUUID(), role: "user", content: "Open a missing file",
    status: "complete", createdAt: new Date().toISOString(),
  } });
  await host.call("session.appendMessage", { sessionId: plain.id, message: {
    id: randomUUID(), role: "assistant", content: "[Missing HTML](missing.html)",
    status: "complete", createdAt: new Date().toISOString(),
  } });
  outside = join(output, "outside.html");
  await writeFile(outside, html);
  for (const [label, content] of [
    ["Outside HTML", "[Outside HTML](<" + outside.replaceAll("\\", "/") + ">)"],
    ["Source line", "Source: Ordinary-scratch.html:1"],
  ]) {
    for (const [role, text] of [["user", "Inspect " + label], ["assistant", content]]) {
      await host.call("session.appendMessage", { sessionId: plain.id, message: {
        id: randomUUID(), role, content: text, status: "complete", createdAt: new Date().toISOString(),
      } });
    }
  }
} finally { await host.stop(); }

const env = { ...process.env, PI_DESKTOP_DATA_DIR: data, PI_DESKTOP_HOST_BIN: binary,
  PI_DESKTOP_MCP_CONTROL: "0", ELECTRON_RENDERER_URL: "", PI_DESKTOP_START_MAXIMIZED: "0" };
delete env.ELECTRON_RUN_AS_NODE;
const { appDir, electronBinary } = resolveElectronBinary(root);
const app = await _electron.launch({ executablePath: electronBinary,
  args: [appDir, "--user-data-dir=" + join(output, "profile")], env, timeout: 60_000 });
let page;
const results = [];
try {
  const ready = Date.now() + 60_000;
  do {
    for (const candidate of app.windows()) {
      if (await candidate.locator(".app-shell").count()) { page = candidate; break; }
    }
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < ready);
  assert.ok(page, "main application window appears");
  page.setDefaultTimeout(25_000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)
      ?.setTitle("PI HTML Link Regression QA"), page.url());
  for (const item of cases) {
    await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), item.sessionId);
    await page.getByRole("link", { name: item.label, exact: true }).click();
    const url = pathToFileURL(item.file).href;
    let guest;
    const deadline = Date.now() + 15_000;
    do {
      guest = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)?.id, url);
      if (guest) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(guest, item.label + ": transcript click must create a real HTML guest");
    assert.equal(await app.evaluate(async ({ webContents, BrowserWindow }, id) => {
      const wc = webContents.fromId(id);
      const visibleGuest = views => views.some(view => view.getVisible() &&
        (view.webContents?.id === id || visibleGuest(view.children)));
      if (!BrowserWindow.getAllWindows().some(window => visibleGuest(window.contentView.children))) {
        throw new Error("The loaded guest is not attached to a visible native surface");
      }
      // WebContentsView is a native child outside Playwright's DOM. The guest
      // interaction is executed in that same real page after its visible
      // attachment is verified above; the screenshot below proves the rendered
      // page, rather than a mocked link, is the surface under test.
      return wc.executeJavaScript("document.querySelector('button').click();document.querySelector('#result').textContent");
    }, guest), "Animation opened");
    const png = await app.evaluate(async ({ webContents }, id) =>
      (await webContents.fromId(id).capturePage()).toPNG().toString("base64"), guest);
    await writeFile(join(output, item.label.replaceAll(" ", "-") + ".png"), Buffer.from(png, "base64"));
    results.push(item.label);
    console.log("PASS " + item.label);
  }
  await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), cases[0].sessionId);
  await page.getByRole("link", { name: "Missing HTML", exact: true }).click();
  await page.getByText("No file matches missing.html", { exact: true }).waitFor();
  results.push("missing file reports its failure");
  await page.getByRole("link", { name: "Outside HTML", exact: true }).click();
  await page.getByText(/is outside the locations this app can access/).waitFor();
  assert.equal(await app.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().some(wc => wc.getURL() === url), pathToFileURL(outside).href), false);
  results.push("outside HTML is rejected without guest navigation");
  await page.getByText("Ordinary-scratch.html:1", { exact: true }).click();
  await page.locator(".file-viewer").waitFor();
  results.push("positioned HTML opens source, not execution");
  // Exercise BrowserPreview through a user send, ToolSearch, sidecar and main.
  // The only fake is the loopback provider, which requests a deterministic tool.
  for (const item of [cases[0], cases[2]]) {
    await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), item.sessionId);
    model.preview(item.file);
    const composer = page.locator('.composer-input[contenteditable="true"]');
    await composer.fill("Open the generated HTML with BrowserPreview.");
    await composer.press("Enter");
    await page.getByText("HTML preview tool completed.", { exact: true })
      .filter({ visible: true }).waitFor({ timeout: 45_000 });
    assert.equal(await app.evaluate(({ webContents, BrowserWindow }, url) => {
      const guest = webContents.getAllWebContents().find(item => item.getURL() === url);
      const visible = views => views.some(view => view.getVisible() &&
        (view.webContents?.id === guest?.id || visible(view.children)));
      return Boolean(guest && BrowserWindow.getAllWindows().some(window => visible(window.contentView.children)));
    }, pathToFileURL(item.file).href), true, "BrowserPreview opens its HTML in the visible native panel");
    assert.deepEqual(model.failures, []);
    results.push("BrowserPreview through actual send: " + item.label);
  }
  await page.screenshot({ path: join(output, "browser-preview-visible.png") });
  results.push("full Electron window captured with BrowserPreview visible");
  await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), cases[0].sessionId);
  await page.evaluate(async () => {
    const result = await window.piDesktop.invoke("pi-desktop/plugin/disable", "pi.browser");
    if (!result.ok) throw new Error(result.error.message);
  });
  await page.getByRole("link", { name: cases[0].label, exact: true }).click();
  await page.locator(".toast-message").filter({
    hasText: "This view could not be loaded. Reload the plugin and try again.",
  }).waitFor();
  results.push("disabled browser reports a visible error without auto-enabling");
  console.log("HTML_LINKS_RESULT " + JSON.stringify({ results, output }));
} catch (error) {
  if (page) await page.screenshot({ path: join(output, "failure.png") });
  console.error("HTML_LINKS_FAILED " + output);
  throw error;
} finally {
  await app.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await app.close();
  await model.close();
}
