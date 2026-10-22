import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMainModule, readMainSource } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  GEN_UI_CONTENT_SECURITY_POLICY,
  GEN_UI_PERMISSIONS_POLICY,
  buildGenUiDocument,
  buildGenUiErrorDocument,
  genUiResponseHeaders,
  isFullHtmlDocument,
  sanitizeGenUiThemeVars,
} = await import("../electron/main/gen-ui-document.ts");
const { GEN_UI_MAX_FRAGMENT_BYTES } = await import("@pi-desktop/shared");

// gen-ui-protocol.ts imports `electron` for `protocol`; load it through a tiny
// stub so the resolver and privileges can be exercised without Electron.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === "electron") return { url: "data:text/javascript,export const protocol = {};", shortCircuit: true };
      return next(specifier, context);
    }
  `)}`,
);
const {
  GEN_UI_SCHEME_PRIVILEGES,
  resolveGenUiRequest,
  resolveGenUiAssetRequest,
  genUiAssetResponse,
  genUiResponse,
} = await import("../electron/main/gen-ui-protocol.ts");
const { genUiAssetFileFromUrl, loadGenUiKit, parseGenUiVendorManifest } = await import(
  "../electron/main/gen-ui-kit.ts"
);

const KIT_DIR = new URL("../resources/gen-ui/", import.meta.url).pathname;
const kit = await loadGenUiKit(KIT_DIR);
const loadKit = async () => kit;
const D3_CDN = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";

const EXPECTED_CSP =
  "default-src 'none'; script-src 'unsafe-inline' pi-genui://assets; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; webrtc 'block'";

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "pi-genui-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const sessionDir = join(dataDir, "visualizations", "sess_1");
  mkdirSync(sessionDir, { recursive: true });
  return { dataDir, sessionDir };
}

const get = (dataDir, url, method = "GET") => resolveGenUiRequest({ method, url, dataDir, loadKit });

test("guest CSP and permissions policy are exact and network-free", () => {
  assert.equal(GEN_UI_CONTENT_SECURITY_POLICY, EXPECTED_CSP);
  for (const feature of ["camera", "microphone", "geolocation", "clipboard-read", "clipboard-write", "display-capture", "usb", "serial", "hid", "payment", "fullscreen"]) {
    assert.match(GEN_UI_PERMISSIONS_POLICY, new RegExp(`(^|, )${feature}=\\(\\)`));
  }
  const headers = genUiResponseHeaders();
  assert.deepEqual(headers, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": EXPECTED_CSP,
    "permissions-policy": GEN_UI_PERMISSIONS_POLICY,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  assert.ok(!Object.keys(headers).some((key) => key.toLowerCase().startsWith("access-control-")));
});

test("shell wraps the fragment between the kit stylesheet/host runtime and the kit runtime", () => {
  const html = buildGenUiDocument('<div id="viz">hello</div>', { kit });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /<meta charset="utf-8">/);
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.equal(meta?.[1].replaceAll("&#39;", "'"), EXPECTED_CSP);
  assert.match(html, /"pi-genui:size"/);
  assert.match(html, /"pi-genui:theme"/);
  assert.match(html, /new ResizeObserver\(schedule\)\.observe\(root\)/);
  assert.match(html, /requestAnimationFrame\(report\)/);
  assert.match(html, /parent\.postMessage\(\{ type: SIZE, height \}, "\*"\)/);
  assert.match(html, /if \(event\.source !== parent\) return;/);
  // Kit stylesheet (agent-facing tokens) is inlined in <head>.
  assert.match(html, /--foreground: var\(/);
  assert.ok(html.indexOf("--foreground: var(") < html.indexOf("</head>"));
  // Fragment comes after the host runtime, inside <body>, and before the kit
  // runtime so tooltips, tabs, and icons see its markup.
  const fragment = html.indexOf('<div id="viz">hello</div>');
  assert.ok(fragment > html.indexOf("<body>"));
  assert.ok(html.indexOf("<body>") > html.indexOf("pi-genui:size"));
  assert.ok(html.indexOf('id="pi-desktop-visualization-tabs"') > fragment);
  assert.doesNotMatch(html, /__INLINE_VISUALIZATION_FRAGMENT__/);
  assert.doesNotMatch(html, /zcode-visualization|window\.zcode/);
  // No remote script URL survives; bundled libraries load from pi-genui://assets.
  assert.doesNotMatch(html, /src="https:/);
  assert.match(html, /src="pi-genui:\/\/assets\/floating-ui-dom-1\.7\.4\.min\.js"/);
});

test("pinned library URLs in the fragment are rewritten to bundled copies; others are left to the CSP", () => {
  const html = buildGenUiDocument(
    `<script src="${D3_CDN}"></script><script src="https://cdn.jsdelivr.net/npm/d3@7.8.0/dist/d3.min.js"></script>`,
    { kit },
  );
  assert.match(html, /<script src="pi-genui:\/\/assets\/d3-7\.9\.0\.min\.js"><\/script>/);
  // An unpinned version stays remote and is blocked by script-src.
  assert.match(html, /d3@7\.8\.0/);
});

test("vendor manifest: only https URLs with plain .js file names are mapped", () => {
  const { vendorUrls, vendorFiles } = parseGenUiVendorManifest(
    JSON.stringify({
      resources: [
        { url: "https://a.example/x.js", file: "x.js" },
        { url: "http://a.example/y.js", file: "y.js" },
        { url: "https://a.example/z.js", file: "../z.js" },
        { url: "https://a.example/w.js", file: "w.css" },
        { url: 1, file: "v.js" },
      ],
    }),
    "/kit/vendor",
  );
  assert.deepEqual([...vendorUrls], [["https://a.example/x.js", "pi-genui://assets/x.js"]]);
  assert.deepEqual([...vendorFiles], [["x.js", "/kit/vendor/x.js"]]);
  assert.deepEqual(
    [...kit.vendorFiles.keys()].sort(),
    ["d3-7.9.0.min.js", "floating-ui-core-1.7.3.min.js", "floating-ui-dom-1.7.4.min.js"],
  );
});

test("assets: only manifest files are served, as cacheable JavaScript", async () => {
  const ok = await resolveGenUiAssetRequest({ method: "GET", url: "pi-genui://assets/d3-7.9.0.min.js", loadKit });
  assert.equal(ok.ok, true);
  const response = genUiAssetResponse(ok);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(await response.text(), /d3js\.org/);
  for (const url of [
    "pi-genui://assets/manifest.json",
    "pi-genui://assets/d3-7.9.0.min.js.LICENSE",
    "pi-genui://assets/../visualize.css",
    "pi-genui://assets/vendor/d3-7.9.0.min.js",
    "pi-genui://assets/missing.js",
    "pi-genui://assets/d3-7.9.0.min.js?x=1",
    "pi-genui://session/sess_1/d3-7.9.0.min.js",
  ]) {
    const result = await resolveGenUiAssetRequest({ method: "GET", url, loadKit });
    assert.equal(result.ok, false, url);
    assert.equal(genUiAssetResponse(result).status, 404, url);
  }
  assert.equal((await resolveGenUiAssetRequest({ method: "POST", url: "pi-genui://assets/d3-7.9.0.min.js", loadKit })).status, 405);
  assert.equal(genUiAssetFileFromUrl("pi-genui://assets/a.js"), "a.js");
  assert.equal(genUiAssetFileFromUrl("pi-genui://assets/a/b.js"), null);
});

test("a missing kit yields the unavailable page, never a half-built document", async (t) => {
  const { dataDir, sessionDir } = fixture(t);
  writeFileSync(join(sessionDir, "chart.html"), "<p>x</p>");
  const result = await resolveGenUiRequest({
    method: "GET",
    url: "pi-genui://session/sess_1/chart.html",
    dataDir,
    loadKit: async () => {
      throw new Error("missing");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(genUiResponse(result).status, 500);
});

test("the kit ships its license notice", () => {
  const notice = readFileSync(join(KIT_DIR, "NOTICE.md"), "utf8");
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(readFileSync(join(KIT_DIR, "LICENSE-APACHE-2.0.txt"), "utf8"), /Apache License\s+Version 2\.0/);
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(
    packageJson.build.extraResources.some((entry) => entry.from === "resources/gen-ui" && entry.to === "gen-ui"),
    "gen-ui kit is packaged",
  );
});

test("theme variables: only short --custom-property strings survive", () => {
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`--v${i}`, "1px"]));
  assert.equal(Object.keys(sanitizeGenUiThemeVars(many)).length, 128);
  assert.deepEqual(
    sanitizeGenUiThemeVars({
      "--color-text-primary": "#fff",
      color: "red",
      "--bad name": "x",
      "--num": 3,
      "--long": "x".repeat(257),
      "--escape": "red;}</style><script>alert(1)</script>",
      "--viz-series-1": "rgb(1 2 3)",
    }),
    { "--color-text-primary": "#fff", "--viz-series-1": "rgb(1 2 3)" },
  );
  assert.deepEqual(sanitizeGenUiThemeVars(null), {});
  assert.deepEqual(sanitizeGenUiThemeVars(["--a"]), {});
  const html = buildGenUiDocument("<p></p>", { kit, themeVars: { "--color-text-primary": "#123456", "--x": "a}b" } });
  assert.match(html, /<style>:root\{--color-text-primary:#123456;\}<\/style>/);
  assert.doesNotMatch(html, /a\}b/);
});

test("full HTML documents are detected past whitespace, BOM, and comments", () => {
  for (const source of ["<!DOCTYPE html><p>", "  <html>", "\uFEFF<head></head>", "<!-- c -->\n<BODY class=x>", "<html/>"]) {
    assert.equal(isFullHtmlDocument(source), true, source);
  }
  for (const source of ["<div><html></html></div>", "<header>", "<bodyx>", "<p>body</p>", "", "<!-- <html> -->\n<div>"]) {
    assert.equal(isFullHtmlDocument(source), false, source);
  }
});

test("a valid fragment is served inside the shell with security headers", async (t) => {
  const { dataDir, sessionDir } = fixture(t);
  writeFileSync(join(sessionDir, "chart.html"), "<svg id=chart></svg>");
  const result = await get(dataDir, "pi-genui://session/sess_1/chart.html");
  assert.equal(result.ok, true);
  assert.match(result.document, /<svg id=chart><\/svg>/);
  const response = genUiResponse(result);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), EXPECTED_CSP);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(await response.text(), /<svg id=chart>/);
});

test("rejections: method, URL shape, traversal, symlinks, non-files, size, documents", async (t) => {
  const { dataDir, sessionDir } = fixture(t);
  writeFileSync(join(sessionDir, "ok.html"), "<p>ok</p>");
  const outside = join(dataDir, "secret.html");
  writeFileSync(outside, "<p>secret</p>");
  symlinkSync(outside, join(sessionDir, "link.html"));
  mkdirSync(join(sessionDir, "dir.html"));
  writeFileSync(join(sessionDir, "big.html"), Buffer.alloc(GEN_UI_MAX_FRAGMENT_BYTES + 1, 0x61));
  writeFileSync(join(sessionDir, "doc.html"), "<!-- hi -->\n<!doctype html><html></html>");
  // A symlinked session directory must not reach outside the root either.
  mkdirSync(join(dataDir, "elsewhere"));
  writeFileSync(join(dataDir, "elsewhere", "ok.html"), "<p>elsewhere</p>");
  symlinkSync(join(dataDir, "elsewhere"), join(dataDir, "visualizations", "linked"));

  const cases = [
    ["POST", "pi-genui://session/sess_1/ok.html", 405],
    ["GET", "pi-genui://session/bad%20id/ok.html", 404],
    ["GET", "pi-genui://session/sess_1/..%2Fsecret.html", 404],
    ["GET", "pi-genui://session/sess_1/../secret.html", 404],
    ["GET", "pi-genui://session/sess_1/ok.txt", 404],
    ["GET", "pi-genui://other/sess_1/ok.html", 404],
    ["GET", "pi-genui://session/sess_1/ok.html?x=1", 404],
    ["GET", "pi-genui://session/sess_1/missing.html", 404],
    ["GET", "pi-genui://session/nosession/ok.html", 404],
    ["GET", "pi-genui://session/sess_1/link.html", 404],
    ["GET", "pi-genui://session/sess_1/dir.html", 404],
    ["GET", "pi-genui://session/linked/ok.html", 404],
    ["GET", "pi-genui://session/sess_1/big.html", 413],
    ["GET", "pi-genui://session/sess_1/doc.html", 422],
  ];
  for (const [method, url, status] of cases) {
    const result = await get(dataDir, url, method);
    assert.equal(result.ok, false, url);
    assert.equal(result.status, status, `${method} ${url}`);
    const response = genUiResponse(result);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-security-policy"), EXPECTED_CSP);
    const body = await response.text();
    assert.ok(!body.includes(dataDir), `error body leaks the data dir for ${url}`);
    assert.ok(!body.includes("secret"), url);
    assert.ok(!body.includes("elsewhere"), url);
  }
  assert.equal(genUiResponse(await get(dataDir, "pi-genui://session/sess_1/ok.html", "POST")).headers.get("allow"), "GET");
  // Missing visualizations root entirely.
  const empty = mkdtempSync(join(tmpdir(), "pi-genui-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal((await get(empty, "pi-genui://session/sess_1/ok.html")).status, 404);
});

test("the data directory is read per request, so references follow relocation", async (t) => {
  const first = fixture(t);
  const second = fixture(t);
  writeFileSync(join(second.sessionDir, "moved.html"), "<p>moved</p>");
  let current = first.dataDir;
  const resolveNow = (url) => get(current, url);
  assert.equal((await resolveNow("pi-genui://session/sess_1/moved.html")).ok, false);
  current = second.dataDir;
  assert.equal((await resolveNow("pi-genui://session/sess_1/moved.html")).ok, true);
  const source = await readMainModule("gen-ui-protocol.ts");
  assert.match(source, /dataDir: input\.getDataDir\(\)/);
});

test("scheme privileges: standard + secure only, registered in the single privileged call", async () => {
  assert.deepEqual(GEN_UI_SCHEME_PRIVILEGES, {
    scheme: "pi-genui",
    privileges: { standard: true, secure: true },
  });
  const mainSource = await readMainSource();
  assert.equal(mainSource.match(/registerSchemesAsPrivileged\(/g)?.length, 1);
  const schemes = await readMainModule("plugin-schemes.ts");
  assert.match(
    schemes,
    /registerSchemesAsPrivileged\(\[\s*PLUGIN_ASSET_SCHEME_PRIVILEGES,\s*PLUGIN_RENDERER_SCHEME_PRIVILEGES,\s*GEN_UI_SCHEME_PRIVILEGES,\s*\]\)/,
  );
  const startup = await readMainModule("bootstrap/startup.ts");
  const install = startup.indexOf("installGenUiProtocol({ getDataDir: () => dataDir });");
  assert.ok(install > startup.indexOf("app.whenReady()"), "protocol handler installs after ready");
});

test("main window CSP adds exactly frame-src pi-genui:", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  assert.ok(csp);
  const directives = csp.split(";").map((part) => part.trim()).filter(Boolean);
  assert.deepEqual(
    directives.filter((directive) => directive.includes("pi-genui")),
    ["frame-src pi-genui:"],
  );
  assert.ok(!directives.some((directive) => directive.startsWith("child-src")));
});

test("error documents carry only a fixed code, never caller text or paths", () => {
  for (const code of ["not-found", "too-large", "not-fragment", "runtime-unavailable"]) {
    const html = buildGenUiErrorDocument(code);
    assert.match(html, new RegExp(`"code":"${code}"|code: ?"${code}"|${code}`));
    assert.doesNotMatch(html, /\/Users\/|\\Users\\/);
  }
});
