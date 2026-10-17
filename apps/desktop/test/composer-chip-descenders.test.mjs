import { readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const composerSource = await readComposerSource();
const styles = await loadStyles();

function ruleBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector} rule`);
  // Prefer the layout rule (height: 28px) when color-only overrides exist first.
  let idx = start;
  while (idx !== -1) {
    const open = source.indexOf("{", idx);
    const close = source.indexOf("}", open);
    const block = source.slice(idx, close + 1);
    if (block.includes("height: 28px")) return block;
    idx = source.indexOf(`${selector} {`, close + 1);
  }
  throw new Error(`no 28px layout rule for ${selector}`);
}

test("model chip label avoids leading-none under truncation", () => {
  assert.match(composerSource, /className="composer-model-thinking-model"/);
  assert.doesNotMatch(
    composerSource,
    /composer-model-thinking-model[^"]*leading-none|truncate text-sm leading-none/,
  );
});

test("model menu options show the complete wire id without truncation", () => {
  assert.match(
    composerSource,
    /const optionTitle = model\.modelId;/,
  );
  assert.match(composerSource, /title=\{optionTitle\}/);
  const optionBlock =
    composerSource.match(/const optionTitle[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(optionBlock, /max-w-\[170px\]|font-mono text-text-secondary/);
});

test("composer runtime chips keep compact line-height for descenders", () => {
  for (const selector of [".mode-chip"]) {
    const block = ruleBlock(styles, selector);
    assert.match(block, /line-height:\s*var\(--leading-compact\);/);
    assert.match(block, /overflow:\s*visible;/);
  }

  assert.match(
    styles,
    /\.composer-model-thinking-chip\s*\{[\s\S]*?line-height:\s*var\(--leading-compact\);/,
  );
  assert.match(
    styles,
    /\.composer-model-thinking-model,\s*\.composer-model-thinking-level\s*\{[\s\S]*?text-overflow:\s*ellipsis;/,
  );
});

test("mode switch labels stay single-line and ellipsize instead of reflowing", () => {
  // Options render from the canonical mode order, so the row no longer depends
  // on one fixed chip width sized for the longest built-in label.
  assert.match(composerSource, /MODE_CYCLE\.map\(\(candidate\) => \(\{/);
  assert.doesNotMatch(styles, /\.composer-mode-chip\s*\{/);
  assert.match(
    styles,
    /\.composer-segment-label\s*\{[\s\S]*?text-overflow:\s*ellipsis;/,
  );
});

test("the committed mode pulses while planning is live", () => {
  assert.match(composerSource, /planning=\{planningLive\}/);
  assert.match(
    composerSource,
    /data-planning=\{planning \? "true" : undefined\}/,
  );
  assert.match(
    composerSource,
    /const planningLive =\s*isRunning &&\s*planningState === "planning" &&\s*\(mode === "plan" \|\| mode === "goal"\)/,
  );
  assert.match(
    styles,
    /\.composer-mode-switch\[data-planning="true"\]\s*\.composer-segment\.is-active svg\s*\{[\s\S]*?animation:\s*composer-mode-planning-pulse/,
  );
  assert.match(
    styles,
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.composer-mode-switch\[data-planning="true"\]\s*\.composer-segment\.is-active svg\s*[,{]/,
  );
});
