import {
  readMainModule,
  readSettingsSource,
  readSharedTypesSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [sharedTypes, settingsSource, windowSource, lifecycleSource, mainStateSource, startupSource] =
  await Promise.all([
    readSharedTypesSource(),
    readSettingsSource(),
    readMainModule("bootstrap/window.ts"),
    readMainModule("bootstrap/app-lifecycle.ts"),
    readMainModule("bootstrap/main-state.ts"),
    readMainModule("bootstrap/startup.ts"),
  ]);

test("the macOS translucency preference is an optional, off-by-default setting", () => {
  assert.match(sharedTypes, /macosWindowTranslucency\?: boolean;/);
  assert.match(mainStateSource, /macosWindowTranslucency = false;/);
  assert.match(
    lifecycleSource,
    /state\.macosWindowTranslucency =\s*process\.platform === "darwin" && settings\?\.macosWindowTranslucency === true;/,
  );
  // The value is read where the window is created, before Electron fixes the
  // surface, and it comes from the settings the boot sequence applied.
  assert.match(windowSource, /windowState\.macosWindowTranslucency,/);
  assert.match(startupSource, /applyMacosWindowTranslucency\(stored\);/);
});

test("a running window cannot switch surfaces, so the preference waits for a launch", async () => {
  const applyBody =
    lifecycleSource.match(/function applyMacosWindowTranslucency\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(applyBody, "expected applyMacosWindowTranslucency");
  assert.doesNotMatch(applyBody, /setVibrancy|setBackgroundColor|new BrowserWindow/);
  // A translucent window keeps its transparent surface for the background IPC,
  // and the renderer reads the created surface so a saved change can show a
  // restart hint instead of faking a live switch.
  const windowIpc = await readMainModule("ipc/window-ipc.ts");
  assert.match(
    windowIpc,
    /process\.platform === "darwin" && isMacosWindowTranslucent\(\)/,
  );
  assert.match(windowIpc, /macosWindowTranslucency: isMacosWindowTranslucent\(\)/);
});

test("the switch is macOS-only and says when a restart is needed", async () => {
  const row = await read("../src/components/settings/MacosWindowTranslucencyRow.tsx");
  assert.match(
    settingsSource,
    /platform === "darwin" && \(\s*<MacosWindowTranslucencyRow settings=\{settings\} saveSettings=\{saveSettings\} \/>/,
  );
  assert.match(row, /settings\.macosWindowTranslucency === true/);
  assert.match(row, /saveSettings\(\{ macosWindowTranslucency: !translucent \}\)/);
  assert.match(row, /t\("settings\.windowTranslucencyRestart"\)/);
  assert.match(row, /const \[applied, setApplied\] = useState<boolean \| null>\(null\)/);
  assert.match(row, /\.windowControl\("getState"\)/);
  assert.match(row, /applied !== null && applied !== translucent/);

  const en = await read("../../../packages/i18n/src/locales/en/index.ts");
  const zh = await read("../../../packages/i18n/src/locales/zh-CN/index.ts");
  for (const source of [en, zh]) {
    for (const key of [
      "windowTranslucency:",
      "windowTranslucencyDesc:",
      "windowTranslucencyRestart:",
    ]) {
      assert.ok(source.includes(key), `missing i18n key ${key}`);
    }
  }
});

test("both settings write paths reject a non-boolean translucency value", async () => {
  const rendererApi = await read("../src/lib/api.ts");
  const mainCatalog = await readMainModule("runtime/provider-catalog.ts");
  assert.match(rendererApi, /"macosWindowTranslucency",\s*\] as const\) \{/);
  assert.match(rendererApi, /typeof value\[key\] !== "boolean"/);
  assert.match(
    mainCatalog,
    /hasOwnProperty\.call\(value, "macosWindowTranslucency"\)[\s\S]*?typeof value\.macosWindowTranslucency !== "boolean"/,
  );
});
