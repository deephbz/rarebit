import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_RAREBIT_SUMMARY_PROMPT_GUIDANCE,
  RAREBIT_SUMMARY_PROMPT_VERSION,
  composeRarebitSummaryDerivationInput,
  composeRarebitSummaryPrompt,
  normalizeRarebitSummaryPrompt,
  rarebitJobIdentity,
  selectRarebits,
} from "../src/rarebit-core.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";
import { resolveRarebitSettings } from "../src/rarebit-settings.mjs";
import {
  RAREBIT_SETTINGS_FIELDS,
  readRarebitSettingsDocument,
  saveRarebitSettingsDocument,
} from "../src/rarebit-settings-ui.mjs";
import {
  createRarebitRecapController,
  RAREBIT_RECAP_WIDGET_KEY,
} from "../src/rarebit-recap.mjs";

const entry = (id, message) => ({
  type: "message",
  id,
  timestamp: "2026-09-27T00:00:00.000Z",
  message,
});

function branch() {
  return [
    entry("u1", { role: "user", content: "Investigate the deployment issue." }),
    entry("a1", { role: "assistant", stopReason: "stop", content: "I found the failing check." }),
  ];
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rarebit-v020-prompt-"));
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(join(root, "agent", "settings.json"), "{}\n");
  const sessionRoot = join(root, "sessions");
  const rarebitRoot = join(root, "rarebit");
  await mkdir(sessionRoot, { recursive: true });
  const sessionFile = join(sessionRoot, "trace.jsonl");
  await writeFile(sessionFile, '{"type":"session","id":"prompt-contract"}\n');
  return { root, sessionRoot, rarebitRoot, sessionFile };
}

function recapContext(summary, setWidget) {
  const branch = [
    entry("recap-u", { role: "user", content: "Read the current deployment state." }),
    entry("recap-a", { role: "assistant", stopReason: "stop", content: "The deployment is complete." }),
  ];
  const selection = selectRarebits(branch);
  const receipt = {
    type: "rarebit_summary",
    status: "ok",
    jobId: "recap-v020-job",
    sessionId: "recap-v020-session",
    branch: { leafId: "recap-a", pathHash: "recap-v020-path" },
    selection: {
      manifestHash: selection.manifestHash,
      selectorVersion: selection.manifest.selectorVersion,
    },
    sessionStatus: "finished",
    observedAt: "2026-09-27T00:00:00.000Z",
    summary,
  };
  return {
    ctx: {
      mode: "tui",
      hasUI: true,
      ui: { setWidget },
      sessionManager: {
        getHeader: () => ({ id: receipt.sessionId }),
        getSessionFile: () => "/tmp/rarebit-v020-recap-session.jsonl",
        getBranch: () => branch,
      },
    },
    current: {
      receipt,
      artifactState: {
        syncState: "assessment_current",
        applicability: "exact_selection",
        receiptRef: { jobId: receipt.jobId },
        projection: { status: receipt.sessionStatus },
      },
    },
  };
}

test("the default summary prompt keeps the current style and has no custom identity", () => {
  const selection = selectRarebits(branch());
  const normalized = normalizeRarebitSummaryPrompt();
  const derivation = composeRarebitSummaryDerivationInput(selection);

  assert.equal(normalized.guidance, DEFAULT_RAREBIT_SUMMARY_PROMPT_GUIDANCE);
  assert.equal(normalized.promptIdentity, null);
  assert.equal(derivation.promptIdentity, null);
  assert.match(derivation.prompt, new RegExp(DEFAULT_RAREBIT_SUMMARY_PROMPT_GUIDANCE));
  assert.equal(derivation.prompt, composeRarebitSummaryPrompt(selection));
});

test("a custom summary_prompt changes prose and job identity", () => {
  const selection = selectRarebits(branch());
  const summaryPrompt = "Use short factual bullets and state uncertainty.";
  const normalized = normalizeRarebitSummaryPrompt(summaryPrompt);
  const custom = composeRarebitSummaryDerivationInput(selection, { summaryPrompt });
  const defaultIdentity = rarebitJobIdentity({
    operation: "summary",
    sessionId: "prompt-contract",
    branch: { leafId: "a1", entryCount: 2, pathHash: "path" },
    selection,
    promptVersion: RAREBIT_SUMMARY_PROMPT_VERSION,
    promptIdentity: null,
  });
  const customIdentity = rarebitJobIdentity({
    operation: "summary",
    sessionId: "prompt-contract",
    branch: { leafId: "a1", entryCount: 2, pathHash: "path" },
    selection,
    promptVersion: RAREBIT_SUMMARY_PROMPT_VERSION,
    promptIdentity: custom.promptIdentity,
  });

  assert.equal(normalized.promptIdentity, custom.promptIdentity);
  assert.ok(custom.promptIdentity);
  assert.match(custom.prompt, /Use short factual bullets and state uncertainty/);
  assert.notEqual(custom.prompt, composeRarebitSummaryPrompt(selection));
  assert.notEqual(customIdentity, defaultIdentity);
});

test("summary_prompt accepts only a nonblank scalar string", () => {
  assert.throws(() => normalizeRarebitSummaryPrompt({ guidance: "custom" }), /summary_prompt/);
  assert.throws(() => normalizeRarebitSummaryPrompt("   "), /summary_prompt/);
  assert.throws(() => normalizeRarebitSummaryPrompt(42), /summary_prompt/);
});

test("settings resolve and round-trip the scalar summary_prompt without changing other namespaces", async () => {
  const f = await fixture();
  await writeFile(f.root + "/agent/settings.json", JSON.stringify({
    theme: "dark",
    other_extension: { keep: true },
    rarebit: { model: "fixture/summary", summary_prompt: "Use an incident timeline." },
  }, null, 2));
  const resolved = resolveRarebitSettings({
    rarebit: { model: "fixture/summary", summary_prompt: "Use an incident timeline." },
  });
  assert.equal(resolved.summaryPrompt, "Use an incident timeline.");
  assert.equal(
    RAREBIT_SETTINGS_FIELDS.some((field) => field.path?.join(".") === "summary_prompt"),
    true,
  );

  const document = await readRarebitSettingsDocument({ agentDir: f.root + "/agent" });
  await saveRarebitSettingsDocument(document, {
    ...document.namespace,
    summary_prompt: "Use an incident timeline with explicit uncertainty.",
  });
  const saved = JSON.parse(await readFile(f.root + "/agent/settings.json", "utf8"));
  assert.equal(saved.theme, "dark");
  assert.deepEqual(saved.other_extension, { keep: true });
  assert.equal(saved.rarebit.summary_prompt, "Use an incident timeline with explicit uncertainty.");
});

test("invalid summary_prompt input fails before the provider or durable receipt", async () => {
  const f = await fixture();
  const calls = [];
  const ctx = {
    sessionManager: {
      getHeader: () => ({ id: "prompt-contract" }),
      getSessionFile: () => f.sessionFile,
      getBranch: branch,
    },
  };

  await assert.rejects(
    processRarebitSummary(ctx, {
      sessionRoot: f.sessionRoot,
      rarebitRoot: f.rarebitRoot,
      forceSynthesis: true,
      model: { provider: "fixture", id: "summary" },
      summaryPrompt: { guidance: "   " },
      modelClient: { complete: async (request) => { calls.push(request); return "{}"; } },
    }),
    /summary_prompt/,
  );
  assert.equal(calls.length, 0);
});

test("custom summary_prompt reaches the provider and prevents reuse of the default receipt", async () => {
  const f = await fixture();
  const requests = [];
  const ctx = {
    sessionManager: {
      getHeader: () => ({ id: "prompt-contract" }),
      getSessionFile: () => f.sessionFile,
      getBranch: branch,
    },
  };
  const common = {
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    forceSynthesis: true,
    model: { provider: "fixture", id: "summary" },
    modelClient: {
      complete: async (request) => {
        requests.push(request);
        return {
          text: JSON.stringify({
            summary: "The deployment issue is recorded.",
            sessionStatus: "finished",
            statusReason: "all_requests_accomplished",
          }),
        };
      },
    },
  };
  const first = await processRarebitSummary(ctx, common);
  const second = await processRarebitSummary(ctx, {
    ...common,
    summaryPrompt: "Use a terse incident report with explicit uncertainty.",
  });

  assert.equal(first.record.status, "ok");
  assert.equal(second.record.status, "ok");
  assert.equal(requests.length, 2);
  assert.doesNotMatch(requests[0].prompt, /terse incident report/);
  assert.match(requests[1].prompt, /terse incident report/);
  assert.notEqual(first.record.jobId, second.record.jobId);
});

test("Recap renders the full multiline Summary through a themed human-only widget", async () => {
  const summary = Array.from({ length: 24 }, (_, index) => `line-${index + 1} FULL_RECAP_TAIL_${index + 1}`).join("\n");
  const widgets = [];
  const { ctx, current } = recapContext(summary, (...args) => widgets.push(args));
  let modelCalls = 0;
  let sessionWrites = 0;
  const controller = createRarebitRecapController({
    readCurrent: async () => current,
  });

  const shown = await controller.showExisting({
    ...ctx,
    modelClient: { complete: async () => { modelCalls += 1; } },
    sessionManager: {
      ...ctx.sessionManager,
      appendMessage: () => { sessionWrites += 1; },
    },
  });
  assert.equal(shown.shown, true);
  assert.equal(widgets[0][0], RAREBIT_RECAP_WIDGET_KEY);
  assert.equal(typeof widgets[0][1], "function");

  const themed = widgets[0][1]({}, {
    bold: (value) => value,
    fg: (tone, value) => `[${tone}]${value}`,
  });
  const rendered = themed.render(200).join("\n");
  assert.match(rendered, /Recap/);
  assert.match(rendered, /line-1 FULL_RECAP_TAIL_1/);
  assert.match(rendered, /line-24 FULL_RECAP_TAIL_24/);
  assert.doesNotMatch(rendered, /recap expand/i);
  assert.match(rendered, /\[muted\]|\[dim\]/);
  assert.equal(modelCalls, 0);
  assert.equal(sessionWrites, 0);

  const refreshed = widgets[0][1]({}, {
    bold: (value) => value,
    fg: (tone, value) => `{${tone}}${value}`,
  });
  assert.match(refreshed.render(200).join("\n"), /\{muted\}|\{dim\}/);
});

test("Recap drops an async display when the Session changes before the widget factory resolves", async () => {
  const widgets = [];
  const first = recapContext("first Summary", (...args) => widgets.push(args));
  const second = recapContext("second Summary", (...args) => widgets.push(args));
  let releaseRead;
  const readCurrent = new Promise((resolve) => { releaseRead = resolve; });
  const controller = createRarebitRecapController({ readCurrent: async () => readCurrent });
  const pending = controller.showExisting(first.ctx);
  controller.invalidate(second.ctx, 2);
  releaseRead(first.current);
  const result = await pending;
  assert.equal(result.shown, false);
  assert.equal(result.reason, "stale");
  assert.equal(widgets.some((call) => call[0] === RAREBIT_RECAP_WIDGET_KEY && call[1]), false);
});
