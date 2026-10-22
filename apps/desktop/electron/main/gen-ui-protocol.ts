import { protocol, type CustomScheme } from "electron";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import {
  GEN_UI_DIRECTORY_NAME,
  GEN_UI_MAX_FRAGMENT_BYTES,
  GEN_UI_SCHEME,
  genUiLocationFromUrl,
  type GenUiErrorCode,
} from "@pi-desktop/shared";
import { GEN_UI_ASSET_HOST, genUiAssetFileFromUrl, type GenUiKit, loadGenUiKit, resolveGenUiKitDir } from "./gen-ui-kit";
import {
  buildGenUiDocument,
  buildGenUiErrorDocument,
  genUiResponseHeaders,
  isFullHtmlDocument,
} from "./gen-ui-document";

/**
 * Serve model-written visualization fragments to transcript cards
 * (ADR gen-ui-inline-visualization).
 *
 * URLs are `pi-genui://session/<sessionId>/<file>.html`. The file is resolved
 * against the *current* data directory on every request, so a reference in
 * an old message keeps working after the data directory moves. The response is
 * the fragment wrapped in the host shell from `gen-ui-document.ts`, which
 * carries the CSP, the Permissions-Policy, and the size/theme runtime.
 */

/**
 * `standard` gives URLs a host and path and lets the iframe document resolve
 * like a page; `secure` keeps the embedding from counting as mixed content.
 * Nothing else: without `supportFetchAPI`/`corsEnabled`, and with no
 * `Access-Control-Allow-Origin` on responses, no other renderer context —
 * including renderer plugins in the main window — can read a visualization's
 * bytes. Only a frame navigation can load it. `bypassCSP` is never set: the
 * guest's own CSP must apply.
 */
export const GEN_UI_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: GEN_UI_SCHEME,
  privileges: {
    standard: true,
    secure: true,
  },
};

export type GenUiResolveResult =
  | { ok: true; document: string }
  | { ok: false; status: 404 | 405 | 413 | 422 | 500; code: GenUiErrorCode };

const NOT_FOUND = { ok: false, status: 404, code: "not-found" } as const;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve one request to a shell document or a safe error. Pure apart from
 * filesystem reads, so it is tested without Electron. Errors carry a fixed
 * code the card localizes; they never echo a path.
 */
export async function resolveGenUiRequest(input: {
  method: string;
  url: string;
  dataDir: string;
  loadKit: () => Promise<GenUiKit>;
}): Promise<GenUiResolveResult> {
  if (input.method !== "GET") {
    return { ok: false, status: 405, code: "not-found" };
  }
  const location = genUiLocationFromUrl(input.url);
  if (!location) return NOT_FOUND;

  const visualizationsRoot = join(input.dataDir, GEN_UI_DIRECTORY_NAME);
  const sessionDir = join(visualizationsRoot, location.sessionId);

  let fragment: string;
  try {
    // The session directory must really live under the visualizations root:
    // a symlinked session directory would otherwise serve any `.html` file on
    // disk with a matching name.
    const [realRoot, realSessionDir] = await Promise.all([
      realpath(visualizationsRoot),
      realpath(sessionDir),
    ]);
    if (!isInside(realRoot, realSessionDir) || realSessionDir === realRoot) return NOT_FOUND;

    // Open the file inside the resolved directory without following a final
    // symlink, then check the opened handle, so a swap between the checks and
    // the read cannot redirect it.
    const filePath = join(realSessionDir, location.fileName);
    // O_NOFOLLOW is unavailable on Windows; keep the lstat check there.
    if ((await lstat(filePath)).isSymbolicLink()) return NOT_FOUND;
    const handle = await open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) return NOT_FOUND;
      if (stats.size > GEN_UI_MAX_FRAGMENT_BYTES) {
        return { ok: false, status: 413, code: "too-large" };
      }
      // Bounded read: a file that grows after stat still cannot exceed the cap.
      const buffer = Buffer.alloc(Math.min(stats.size, GEN_UI_MAX_FRAGMENT_BYTES) + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > GEN_UI_MAX_FRAGMENT_BYTES) {
        return { ok: false, status: 413, code: "too-large" };
      }
      fragment = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }

    if (isFullHtmlDocument(fragment)) {
      return {
        ok: false,
        status: 422,
        code: "not-fragment",
      };
    }
  } catch {
    return NOT_FOUND;
  }

  let kit: GenUiKit;
  try {
    kit = await input.loadKit();
  } catch {
    // A shell without its kit would look loaded while tooltips, tabs, and
    // icons silently fail; show the unavailable state instead.
    return { ok: false, status: 500, code: "runtime-unavailable" };
  }
  return { ok: true, document: buildGenUiDocument(fragment, { kit }) };
}

export type GenUiAssetResult = { ok: true; body: Buffer } | { ok: false; status: 404 | 405 };

/**
 * Serve one bundled kit library. Only files listed in the vendor manifest are
 * served, by exact name; nothing under the data directory is reachable here.
 */
export async function resolveGenUiAssetRequest(input: {
  method: string;
  url: string;
  loadKit: () => Promise<GenUiKit>;
}): Promise<GenUiAssetResult> {
  if (input.method !== "GET") return { ok: false, status: 405 };
  const file = genUiAssetFileFromUrl(input.url);
  if (!file) return { ok: false, status: 404 };
  try {
    const path = (await input.loadKit()).vendorFiles.get(file);
    if (!path) return { ok: false, status: 404 };
    return { ok: true, body: await readFile(path) };
  } catch {
    return { ok: false, status: 404 };
  }
}

/** Bundled libraries are immutable per app build, so they may be cached. */
export function genUiAssetResponse(result: GenUiAssetResult): Response {
  if (!result.ok) return new Response(null, { status: result.status });
  return new Response(new Uint8Array(result.body), {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

/** Turn a resolve result into the HTTP response the frame receives. */
export function genUiResponse(result: GenUiResolveResult): Response {
  if (result.ok) {
    return new Response(result.document, { status: 200, headers: genUiResponseHeaders() });
  }
  const headers = genUiResponseHeaders();
  if (result.status === 405) headers.allow = "GET";
  return new Response(buildGenUiErrorDocument(result.code), {
    status: result.status,
    headers,
  });
}

function isGenUiAssetRequest(url: string): boolean {
  try {
    return new URL(url).hostname === GEN_UI_ASSET_HOST;
  } catch {
    return false;
  }
}

let kitPromise: Promise<GenUiKit> | null = null;

/** Load the kit once per process; a failed load is retried on the next request. */
function loadInstalledKit(): Promise<GenUiKit> {
  if (!kitPromise) {
    const dir = resolveGenUiKitDir();
    kitPromise = dir ? loadGenUiKit(dir) : Promise.reject(new Error("gen-ui kit directory not found"));
    kitPromise.catch((error: unknown) => {
      kitPromise = null;
      console.warn("[gen-ui] visualization kit unavailable:", error instanceof Error ? error.message : error);
    });
  }
  return kitPromise;
}

/**
 * Install the request handler. Call once, after the app is ready. `getDataDir`
 * is read per request so the handler follows the data directory in use.
 */
export function installGenUiProtocol(input: { getDataDir: () => string }): void {
  protocol.handle(GEN_UI_SCHEME, async (request) => {
    if (isGenUiAssetRequest(request.url)) {
      return genUiAssetResponse(
        await resolveGenUiAssetRequest({ method: request.method, url: request.url, loadKit: loadInstalledKit }),
      );
    }
    return genUiResponse(
      await resolveGenUiRequest({
        method: request.method,
        url: request.url,
        dataDir: input.getDataDir(),
        loadKit: loadInstalledKit,
      }),
    );
  });
}
