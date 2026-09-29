import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_RAREBIT_MAX_INPUT_TOKENS,
  DEFAULT_RAREBIT_RECAP_TIMEZONE,
  normalizeRarebitRecapTimezone,
  resolveRarebitSettings,
} from "../src/rarebit-settings.mjs";
import {
  DEFAULT_RAREBIT_MAX_PROMPT_CHARS,
  processRarebitSummary,
} from "../src/rarebit-service.mjs";
import { createRarebitRecapController } from "../src/rarebit-recap.mjs";
import { selectRarebits, sha256 } from "../src/rarebit-core.mjs";
import { extractRarebitSynthesisReceipt } from "../src/rarebit-model.mjs";
import registerPiRarebit, { readConfiguredRarebitSettings } from "../src/extension.mjs";
import {
  RAREBIT_SETTINGS_TABS,
  openRarebitPalette,
  openRarebitSettings,
  readRarebitSettingsDocument,
  saveRarebitSettingsDocument,
} from "../src/rarebit-settings-ui.mjs";
import { parseRarebitCommand } from "../src/rarebit-command.mjs";

async function fixture(initial = {}) {
  const root = await mkdtemp(join(tmpdir(), "rarebit-settings-ui-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const settingsFile = join(agentDir, "settings.json");
  const projectSettings = join(cwd, ".pi", "settings.json");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(settingsFile, `${JSON.stringify(initial, null, 2)}\n`);
  return { root, cwd, agentDir, settingsFile, projectSettings };
}

function theme() {
  return {
    bold: (value) => value,
    fg: (_role, value) => value,
  };
}

function context(box, ui, overrides = {}) {
  return {
    mode: "tui",
    hasUI: true,
    cwd: box.cwd,
    isProjectTrusted: () => true,
    ui,
    ...overrides,
  };
}

test("resolved settings keep diagnostics quiet by default and retain global values through project partial overrides", () => {
  const resolved = resolveRarebitSettings(
    {
      rarebit: {
        model: "fixture/summary",
        diagnostics: { summary_triggered: true, summary_updated: false },
        max_input_tokens: 64_000,
        recap: { enabled: false, delay_ms: 10_000, timezone: "Asia/Hong_Kong" },
      },
    },
    { rarebit: { recap: { delay_ms: 2_000 } } },
  );

  assert.equal(resolved.diagnostics.summaryTriggered, true);
  assert.equal(resolved.diagnostics.summaryUpdated, false);
  assert.equal(resolved.recap.enabled, false);
  assert.equal(resolved.recap.delayMs, 2_000);
  assert.equal(resolved.recap.timezone, "Asia/Hong_Kong");
  assert.equal(resolved.maxInputTokens, DEFAULT_RAREBIT_MAX_INPUT_TOKENS);

  const defaults = resolveRarebitSettings({ rarebit: { model: "fixture/summary" } });
  assert.deepEqual(defaults.diagnostics, { summaryTriggered: false, summaryUpdated: false });
  assert.equal(defaults.recap.timezone, DEFAULT_RAREBIT_RECAP_TIMEZONE);
});

test("the real settings loader preserves a global disabled Recap through a partial trusted-project override", async () => {
  const box = await fixture({
    rarebit: {
      model: "fixture/summary",
      diagnostics: { summary_triggered: false, summary_updated: false },
      max_input_tokens: 64_000,
      recap: { enabled: false, delay_ms: 60_000, timezone: "Asia/Hong_Kong" },
    },
  });
  await writeFile(box.projectSettings, JSON.stringify({
    other_extension: { preserve: true },
    rarebit: { recap: { delay_ms: 2_000 } },
  }, null, 2));

  const effective = await readConfiguredRarebitSettings({
    cwd: box.cwd,
    agentDir: box.agentDir,
    projectTrusted: true,
    model: { provider: "fixture", id: "summary" },
  });
  assert.equal(effective.maxInputTokens, 64_000);
  assert.deepEqual(effective.diagnostics, { summaryTriggered: false, summaryUpdated: false });
  assert.equal(effective.recap.enabled, false);
  assert.equal(effective.recap.delayMs, 2_000);
  assert.equal(effective.recap.timezone, "Asia/Hong_Kong");

  const projectDocument = await readRarebitSettingsDocument({
    cwd: box.cwd,
    agentDir: box.agentDir,
    scope: "project",
    projectTrusted: true,
  });
  await saveRarebitSettingsDocument(projectDocument, {
    ...projectDocument.namespace,
    recap: { ...projectDocument.namespace.recap, timezone: "UTC" },
  });
  const global = JSON.parse(await readFile(box.settingsFile, "utf8"));
  const project = JSON.parse(await readFile(box.projectSettings, "utf8"));
  assert.equal(global.rarebit.recap.enabled, false);
  assert.equal(global.rarebit.recap.timezone, "Asia/Hong_Kong");
  assert.deepEqual(project.other_extension, { preserve: true });
  assert.equal(project.rarebit.recap.delay_ms, 2_000);
  assert.equal(project.rarebit.recap.timezone, "UTC");
});

test("recap timezone accepts an IANA zone and falls back to host for invalid input", () => {
  assert.equal(normalizeRarebitRecapTimezone("Asia/Hong_Kong"), "Asia/Hong_Kong");
  assert.equal(normalizeRarebitRecapTimezone("not/a-timezone"), DEFAULT_RAREBIT_RECAP_TIMEZONE);
  assert.equal(normalizeRarebitRecapTimezone(""), DEFAULT_RAREBIT_RECAP_TIMEZONE);
});

test("summary service maps the configurable input-token limit to the persisted character cap", async () => {
  const branch = [
    { id: "u1", type: "message", message: { role: "user", content: [{ type: "text", text: "A request" }] } },
    { id: "a1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "A response" }] } },
  ];
  const result = await processRarebitSummary(
    { sessionManager: { getBranch: () => branch } },
    { branch, maxInputTokens: 32_000, forceSynthesis: true },
  );
  assert.equal(result.record.inputCoveragePolicy.maxPromptChars, 128_000);
  assert.equal(DEFAULT_RAREBIT_MAX_PROMPT_CHARS, DEFAULT_RAREBIT_MAX_INPUT_TOKENS * 4);
});

test("recap renders the human label and converts the receipt timestamp to the configured timezone", async () => {
  const branch = [
    { id: "u1", type: "message", message: { role: "user", content: [{ type: "text", text: "A request" }] } },
    { id: "a1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "A response" }] } },
  ];
  const selection = selectRarebits(branch);
  const observedAt = "2026-01-01T00:00:00.000Z";
  const model = { provider: "fixture", id: "summary" };
  const receipt = {
    schemaVersion: 4, type: "rarebit_summary", status: "ok", jobId: sha256("job-1"), sessionId: "session-1",
    branch: { leafId: "a1", entryCount: 2, pathHash: sha256(["u1", "a1"]) }, observedAt,
    selection: { manifestHash: selection.manifestHash, selectorVersion: selection.manifest.selectorVersion,
      occurrenceCount: selection.occurrences.length, uniquePayloadCount: selection.payloads.length, latestUserSourceEntryId: "u1" },
    lifecycleBoundary: "agent_settled", implementationVersion: "hc-rarebit-summary-v7", synthesisMode: "forced",
    inputCoveragePolicy: { strategy: "newest_suffix_with_explicit_omission", maxPromptChars: 10_000 },
    promptVersion: "rarebit-summary-v8", model, modelProvenance: { source: "test", status: "resolved" },
    summary: "A current summary.", sessionStatus: "needs_attention", statusReason: "approval",
    inputCoverage: { totalMessageCount: selection.occurrences.length, includedMessageCount: selection.occurrences.length, omittedMessageCount: 0, omittedTextChars: 0, promptChars: 100, complete: true },
    synthesis: extractRarebitSynthesisReceipt({}, { requestedModel: model, startedAt: observedAt, completedAt: observedAt, durationMs: 0 }),
  };
  const widgets = [];
  const context = {
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getHeader: () => ({ id: "session-1" }),
      getSessionFile: () => "/tmp/rarebit-settings-ui-session.jsonl",
      getBranch: () => branch,
    },
    ui: { setWidget: (_key, lines) => widgets.push(lines) },
  };
  const controller = createRarebitRecapController({
    timezone: "Asia/Hong_Kong",
    readCurrent: async () => ({
      receipt,
      artifactState: {
        syncState: "assessment_current",
        applicability: "exact_selection",
        receiptRef: { jobId: receipt.jobId },
        projection: { status: "needs_attention" },
      },
    }),
  });
  const result = await controller.showExisting(context);
  assert.equal(result.shown, true);
  const heading = widgets[0]({ requestRender() {} }, { fg: (_name, text) => text }).render(200).find((line) => line.includes("Recap·")).trim();
  assert.match(heading, /^(?:◆!)?Recap·needsyou·01\/01 08:00\(GMT\+8\)/);
  assert.doesNotMatch(heading, /as of|2026|Asia\/Hong_Kong/);
  assert.doesNotMatch(heading, /Rarebit Summary/);
});

test("quiet Summary diagnostics still report materialization failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-settings-failure-"));
  const handlers = new Map();
  const commands = new Map();
  const notices = [];
  let providerCalls = 0;
  registerPiRarebit(
    {
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    },
    {
      model: { provider: "fixture", id: "summary" },
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
      sessionRoot: root,
      rarebitRoot: join(root, "rarebit"),
      queryAutomaticSummaryPolicy: async () => ({ decision: "abstain", queryStatus: "test" }),
      modelClient: { complete: async () => { providerCalls += 1; throw new Error("synthetic provider failure"); } },
      diagnostics: { summaryTriggered: false, summaryUpdated: false },
    },
  );
  const branch = [
    { id: "u1", type: "message", message: { role: "user", content: [{ type: "text", text: "A request" }] } },
    { id: "a1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "A response" }] } },
  ];
  const context = {
    mode: "tui",
    cwd: root,
    hasUI: true,
    isProjectTrusted: () => true,
    sessionManager: {
      getHeader: () => ({ id: "session-failure" }),
      getSessionFile: () => join(root, "session.jsonl"),
      getBranch: () => branch,
    },
    ui: { notify: (text, level) => notices.push({ text, level }) },
  };
  handlers.get("session_start")({}, context);
  const waitForFailure = async (count) => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && notices.filter(({ text, level }) => level === "error" && /Summary failed/.test(text)).length < count)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(notices.filter(({ text, level }) => level === "error" && /Summary failed/.test(text)).length, count);
  };
  await commands.get("rarebit").handler("summarize", context);
  await waitForFailure(1);
  await commands.get("rarebit").handler("summarize", context);
  await waitForFailure(2);
  assert.equal(providerCalls, 1, "the cached failure reuses the original provider outcome");
  assert.equal(notices.some(({ text }) => /already current|updated and current/.test(text)), false);
  assert.equal(notices.some(({ text }) => /Summary triggered/.test(text)), false);
});

test("settings document round-trip preserves Pi and other extension namespaces", async () => {
  const box = await fixture({
    theme: "dark",
    another_extension: { enabled: true },
    rarebit: {
      model: "fixture/summary",
      recap: { enabled: false, delay_ms: 60_000, timezone: "UTC" },
      max_input_tokens: 64_000,
    },
  });
  const document = await readRarebitSettingsDocument({ cwd: box.cwd, agentDir: box.agentDir, scope: "global" });
  const saved = await saveRarebitSettingsDocument(document, {
    ...document.namespace,
    max_input_tokens: 32_000,
    recap: { ...document.namespace.recap, timezone: "Asia/Hong_Kong" },
  });
  const parsed = JSON.parse(await readFile(box.settingsFile, "utf8"));
  assert.equal(parsed.theme, "dark");
  assert.deepEqual(parsed.another_extension, { enabled: true });
  assert.equal(parsed.rarebit.max_input_tokens, 32_000);
  assert.equal(parsed.rarebit.recap.timezone, "Asia/Hong_Kong");
  assert.notEqual(saved.revision, document.revision);
});

test("settings cancel and invalid input leave the file unchanged and do not enter the Session", async () => {
  const box = await fixture({
    unrelated: { keep: "yes" },
    rarebit: { model: "fixture/summary", max_input_tokens: 64_000 },
  });
  const before = await readFile(box.settingsFile, "utf8");
  let customCalls = 0;
  let modelCalls = 0;
  let sessionWrites = 0;
  const notifications = [];
  const ui = {
    custom: async (factory) => {
      customCalls += 1;
      if (customCalls > 2) return undefined;
      let selected;
      const component = factory({ requestRender() {} }, theme(), {}, (value) => { selected = value; });
      assert.match(component.render(120).join("\n"), /Actions.*Summary.*Recap.*Session/);
      if (customCalls === 1) {
        component.handleInput("\t");
        component.handleInput("\x1b[B");
        component.handleInput("\x1b[B");
        component.handleInput("\r");
        return selected;
      }
      return undefined;
    },
    input: async () => "not/a-timezone",
    select: async () => undefined,
    confirm: async () => false,
    notify: (message, level) => notifications.push({ message, level }),
  };
  await openRarebitSettings(context(box, ui, {
    sendUserMessage: () => { modelCalls += 1; },
    sessionManager: { appendMessage: () => { sessionWrites += 1; } },
  }), { agentDir: box.agentDir, initialScope: "global" });
  assert.equal(await readFile(box.settingsFile, "utf8"), before);
  assert.equal(modelCalls, 0);
  assert.equal(sessionWrites, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "error");
});

test("settings confirmation cancel leaves the source file unchanged", async () => {
  const box = await fixture({ rarebit: { model: "fixture/summary" } });
  const before = await readFile(box.settingsFile, "utf8");
  let customCalls = 0;
  const ui = {
    custom: async (factory) => {
      customCalls += 1;
      if (customCalls > 2) return undefined;
      let selected;
      const component = factory({ requestRender() {} }, theme(), {}, (value) => { selected = value; });
      if (customCalls === 1) component.handleInput("\r");
      return selected;
    },
    select: async () => "on",
    confirm: async () => false,
    notify: () => {},
  };
  await openRarebitSettings(context(box, ui), { agentDir: box.agentDir });
  assert.equal(await readFile(box.settingsFile, "utf8"), before);
});

test("settings UI exposes the tabbed Summary and Recap controls and saves a confirmed edit", async () => {
  const box = await fixture({ rarebit: { model: "fixture/summary" } });
  const rendered = [];
  let customCalls = 0;
  const ui = {
    custom: async (factory) => {
      customCalls += 1;
      if (customCalls > 2) return undefined;
      let selected;
      const component = factory({ requestRender() {} }, theme(), {}, (value) => { selected = value; });
      rendered.push(component.render(120).join("\n"));
      if (customCalls === 1) {
        component.handleInput("\r");
      }
      return selected;
    },
    select: async () => "on",
    confirm: async () => true,
    notify: () => {},
  };
  await openRarebitSettings(context(box, ui), { agentDir: box.agentDir });
  assert.deepEqual(RAREBIT_SETTINGS_TABS, ["Actions", "Summary", "Recap", "Session"]);
  assert.match(rendered[0], /Rarebit Settings/);
  assert.match(rendered[0], /Show Summary triggered/);
  const parsed = JSON.parse(await readFile(box.settingsFile, "utf8"));
  assert.equal(parsed.rarebit?.diagnostics?.summary_triggered, true);
});

test("the Rarebit palette is a human-only TUI surface and includes settings and Recap", async () => {
  const box = await fixture({});
  let modelCalls = 0;
  let sessionWrites = 0;
  let rendered = "";
  const ui = {
    custom: async (factory) => {
      let selected;
      const component = factory({ requestRender() {} }, theme(), {}, (value) => { selected = value; });
      rendered = component.render(120).join("\n");
      component.handleInput("\x1b");
      return selected;
    },
    notify: () => {},
  };
  const selection = await openRarebitPalette(context(box, ui, {
    sendUserMessage: () => { modelCalls += 1; },
    sessionManager: { appendMessage: () => { sessionWrites += 1; } },
  }));
  assert.equal(selection, undefined);
  assert.match(rendered, /Rarebit/);
  assert.match(rendered, /Summary/);
  assert.match(rendered, /Recap/);
  assert.match(rendered, /Settings/);
  assert.equal(modelCalls, 0);
  assert.equal(sessionWrites, 0);
});

test("/rarebit keeps menu and settings under one command surface", () => {
  assert.deepEqual(parseRarebitCommand(""), { ok: true, subcommand: "menu", arguments: [] });
  assert.deepEqual(parseRarebitCommand("settings"), { ok: true, subcommand: "settings", arguments: [] });
  assert.deepEqual(parseRarebitCommand("settings project"), { ok: true, subcommand: "settings", arguments: ["project"] });
});
