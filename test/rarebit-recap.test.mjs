import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { selectRarebits, sha256 } from "../src/rarebit-core.mjs";
import registerPiRarebit from "../src/extension.mjs";
import { readConfiguredRarebitSettings } from "../src/extension.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";
import { readRarebitSession } from "../src/rarebit-session.mjs";
import { readRarebitCurrent } from "../src/rarebit-store.mjs";
import {
  createRarebitRecapController,
  DEFAULT_RAREBIT_RECAP_DELAY_MS,
  RAREBIT_RECAP_WIDGET_KEY,
} from "../src/rarebit-recap.mjs";

function branchFor(id = "assistant-1") {
  return [
    {
      type: "message",
      id: "owner-1",
      message: { role: "user", content: "synthetic owner request" },
    },
    {
      type: "message",
      id,
      message: {
        role: "assistant",
        stopReason: "stop",
        content: "synthetic completed response",
      },
    },
  ];
}

function contextFor({ sessionId = "session-1", sessionFile = "/tmp/session-1.jsonl", branch = branchFor(), setWidget }) {
  return {
    mode: "tui",
    hasUI: true,
    ui: { setWidget },
    sessionManager: {
      getHeader: () => ({ id: sessionId }),
      getSessionFile: () => sessionFile,
      getBranch: () => branch,
    },
  };
}

function receiptFor(ctx, jobId = "job-1") {
  const branch = ctx.sessionManager.getBranch();
  const selection = selectRarebits(branch);
  const observedAt = "2026-09-27T00:00:00.000Z";
  const latestUser = selection.occurrences.filter((item) => item.role === "user").at(-1);
  return {
    schemaVersion: 4,
    type: "rarebit_summary",
    status: "ok",
    jobId: /^[a-f0-9]{64}$/.test(jobId) ? jobId : "1".repeat(64),
    sessionId: ctx.sessionManager.getHeader().id,
    implementationVersion: "hc-rarebit-summary-v7",
    synthesisMode: "forced",
    lifecycleBoundary: "agent_settled",
    inputCoveragePolicy: { strategy: "newest_suffix_with_explicit_omission", maxPromptChars: 10_000 },
    promptVersion: "rarebit-summary-v8",
    model: { provider: "test", id: "model" },
    modelProvenance: { source: "test", status: "resolved" },
    observedAt,
    branch: { leafId: branch.at(-1)?.id ?? null, entryCount: branch.length, pathHash: sha256(branch.map((item) => item.id)) },
    selection: {
      manifestHash: selection.manifestHash,
      selectorVersion: selection.manifest.selectorVersion,
      occurrenceCount: selection.occurrences.length,
      uniquePayloadCount: selection.payloads.length,
      latestUserSourceEntryId: latestUser?.sourceEntryId ?? null,
    },
    sessionStatus: "finished",
    statusReason: "all_requests_accomplished",
    inputCoverage: { totalMessageCount: selection.occurrences.length, includedMessageCount: selection.occurrences.length, omittedMessageCount: 0, omittedTextChars: 0, promptChars: 500, complete: true },
    summary: "RECAP_SENTINEL: display-only current Summary",
    synthesis: {
      schemaVersion: 1, kind: "rarebit_model_synthesis", outcome: "complete",
      requestedModel: { provider: "test", id: "model" },
      timing: { startedAt: observedAt, completedAt: observedAt, durationMs: 0, provenance: "local_monotonic_clock" },
      provider: Object.fromEntries(["responseProvider", "responseProviderSource", "responseModel", "responseModelSource", "responseId", "responseIdSource", "requestId", "requestIdSource"].map((key) => [key, null])),
      usage: { availability: "unavailable", ...Object.fromEntries(["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "estimatedCostUsd"].map((key) => [key, null])), provenance: Object.fromEntries(["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "estimatedCostUsd"].map((key) => [key, null])) },
    },
  };
}

function currentFor(receipt) {
  return {
    receipt,
    artifactState: {
      syncState: "assessment_current",
      applicability: "exact_selection",
      receiptRef: { jobId: receipt.jobId },
      projection: { status: receipt.sessionStatus },
    },
  };
}

test("request-prefix Recap stores only the receipt evidence cut and its hash", async () => {
  const branch = branchFor("later-assistant");
  branch[1].message.stopReason = "toolUse";
  const ctx = contextFor({ branch, setWidget() {} });
  const prefix = selectRarebits(branch.slice(0, 1));
  const receipt = {
    ...receiptFor(ctx), lifecycleBoundary: "owner_request", sessionStatus: "user_requested",
    statusReason: "owner_request_recorded",
    selection: {
      manifestHash: prefix.manifestHash,
      selectorVersion: prefix.manifest.selectorVersion,
      occurrenceCount: prefix.occurrences.length,
      uniquePayloadCount: prefix.payloads.length,
      latestUserSourceEntryId: "owner-1",
    },
  };
  const saved = [];
  const controller = createRarebitRecapController({
    delayMs: 0,
    appendEntry: (type, data) => {
      const entry = { type: "custom", customType: type, id: `entry-${saved.length}`, data };
      saved.push(entry);
      branch.push(entry);
    },
    readCurrent: async () => ({ receipt, artifactState: {
      syncState: "request_current", applicability: "request_generation",
      receiptRef: { jobId: receipt.jobId }, projection: { status: receipt.sessionStatus },
    } }),
  });
  const result = await controller.showExisting(ctx);
  assert.equal(result.shown, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].data.coveredEntryId, "owner-1");
  assert.equal(saved[0].data.selectionHash, prefix.manifestHash);
  assert.equal((await controller.showExisting(ctx)).shown, true);
  assert.equal(saved.length, 1, "redisplay reuses the active-branch Recap identity");
  const rendered = controller.renderEntry(saved[0], {}, { fg: (_tone, text) => text }).render(15);
  assert.ok(rendered.some((line) => line.includes("Recap·") && line.endsWith("[got it]")), "ANSI-aware truncation reserves the inline action width");
  assert.equal(rendered.some((line) => line.trim() === "[got it]"), false);
});

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)
          .at(0);
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        await timer.callback();
      }
      now = target;
    },
    get pending() {
      return timers.size;
    },
  };
}

test("a request-prefix Recap rejects a live assistant stop while settlement is pending", async () => {
  const branch = branchFor();
  const ctx = contextFor({ branch, setWidget() {} });
  const prefix = selectRarebits(branch.slice(0, 1));
  const receipt = { ...receiptFor(ctx), lifecycleBoundary: "owner_request", sessionStatus: "user_requested",
    statusReason: "owner_request_recorded", selection: {
    manifestHash: prefix.manifestHash, selectorVersion: prefix.manifest.selectorVersion,
    occurrenceCount: 1, uniquePayloadCount: prefix.payloads.length,
    latestUserSourceEntryId: "owner-1",
  } };
  const controller = createRarebitRecapController({ readCurrent: async () => ({ receipt, artifactState: {
    syncState: "request_current", applicability: "request_generation",
    receiptRef: { jobId: receipt.jobId }, projection: { status: receipt.sessionStatus },
  } }) });
  const result = await controller.showExisting(ctx);
  assert.equal(result.shown, false);
  assert.equal(result.reason, "settlement_pending");
});

test("Recap reprojects the live branch after asynchronous renderer imports", async () => {
  const branch = branchFor();
  const ctx = contextFor({ branch, setWidget() {} });
  const receipt = receiptFor(ctx);
  let reads = 0;
  const saved = [];
  const controller = createRarebitRecapController({
    appendEntry: (type, data) => saved.push({ type, data }),
    readCurrent: async () => {
      reads += 1;
      if (reads === 2) branch.push({ id: "new-user", type: "message", message: { role: "user", content: "new request" } });
      return currentFor(receipt);
    },
  });
  const result = await controller.showExisting(ctx);
  assert.equal(reads, 2);
  assert.equal(result.shown, false);
  assert.equal(saved.length, 0);
});

test("default recap delay is one minute and a current receipt renders only in the TUI widget", async () => {
  assert.equal(DEFAULT_RAREBIT_RECAP_DELAY_MS, 60_000);
  const clock = fakeClock();
  const widgets = [];
  const ctx = contextFor({
    setWidget: (...args) => widgets.push(args),
  });
  const receipt = receiptFor(ctx);
  let reads = 0;
  const controller = createRarebitRecapController({
    readCurrent: async () => {
      reads += 1;
      return currentFor(receipt);
    },
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  controller.updateContext(ctx);
  const token = controller.captureMaterialization(ctx);
  assert.equal(
    controller.offer({ ctx, result: { record: receipt }, token }),
    true,
  );
  await clock.advance(59_999);
  assert.equal(widgets.length, 0);
  assert.equal(reads, 0);
  assert.equal(clock.pending, 1);

  await clock.advance(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2, "the live projection is rechecked after renderer imports");
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0][0], RAREBIT_RECAP_WIDGET_KEY);
  assert.match(widgetText(widgets[0][1]), /RECAP_SENTINEL/);
  assert.deepEqual(widgets[0][2], { placement: "aboveEditor" });
});

test("typing does not clear the recap, but submitted input and a new turn do", async () => {
  const clock = fakeClock();
  const widgets = [];
  const ctx = contextFor({ setWidget: (...args) => widgets.push(args) });
  const receipt = receiptFor(ctx);
  const controller = createRarebitRecapController({
    delayMs: 1,
    readCurrent: async () => currentFor(receipt),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  controller.updateContext(ctx);
  controller.offer({
    ctx,
    result: { record: receipt },
    token: controller.captureMaterialization(ctx),
  });
  await clock.advance(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(widgets.length, 1);

  // Pi has no event for each editor keystroke. The recap remains visible while
  // the owner types; only a submitted input or lifecycle transition clears it.
  assert.equal(widgets.length, 1);
  controller.invalidate(ctx, 1);
  assert.equal(widgets.at(-1)[1], undefined);

  controller.offer({
    ctx,
    result: { record: receipt },
    token: controller.captureMaterialization(ctx),
  });
  controller.invalidate(ctx, 2);
  await clock.advance(1);
  assert.equal(widgets.filter((call) => call[1] !== undefined).length, 1);
  assert.equal(clock.pending, 0);
});

test("session or branch changes cancel a detached read and cannot render stale completion", async () => {
  const clock = fakeClock();
  const widgets = [];
  const firstBranch = branchFor("assistant-1");
  const first = contextFor({
    sessionId: "session-1",
    sessionFile: "/tmp/session-1.jsonl",
    branch: firstBranch,
    setWidget: (...args) => widgets.push(args),
  });
  const secondBranch = branchFor("assistant-2");
  const second = contextFor({
    sessionId: "session-2",
    sessionFile: "/tmp/session-2.jsonl",
    branch: secondBranch,
    setWidget: (...args) => widgets.push(args),
  });
  const receipt = receiptFor(first);
  let resolveRead;
  const readPending = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const controller = createRarebitRecapController({
    delayMs: 1,
    readCurrent: async () => readPending,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  controller.updateContext(first);
  controller.offer({
    ctx: first,
    result: { record: receipt },
    token: controller.captureMaterialization(first),
  });
  const advancing = clock.advance(1);
  await Promise.resolve();
  controller.invalidate(second, 2);
  resolveRead(currentFor(receipt));
  await advancing;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    widgets.some((call) => call[0] === RAREBIT_RECAP_WIDGET_KEY && call[1]),
    false,
  );
  assert.equal(widgets.at(-1)[1], undefined);
});

test("showExisting accepts current metadata-only branch drift and rejects changed selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-recap-branch-drift-"));
  const sessionRoot = join(root, "sessions");
  const rarebitRoot = join(root, "rarebit");
  const manager = SessionManager.create(root, sessionRoot);
  const timestamp = Date.now();
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "fixture owner request" }],
    timestamp,
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "fixture completed response" }],
    api: "openai-completions",
    provider: "fixture",
    model: "summary",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: timestamp + 1,
  });
  const sessionFile = manager.getSessionFile();
  const baseContext = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    model: { provider: "fixture", id: "summary" },
    sessionManager: manager,
  };
  try {
    const materialized = await processRarebitSummary(baseContext, {
      sessionRoot,
      rarebitRoot,
      model: { provider: "fixture", id: "summary" },
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
      lifecycleBoundary: "agent_settled",
      queryAutomaticSummaryPolicy: async () => ({ decision: "abstain" }),
      modelClient: {
        complete: async () => ({
          text: JSON.stringify({
            summary: "fixture current Summary",
            sessionStatus: "finished",
            statusReason: "all_requests_accomplished",
          }),
        }),
      },
    });
    assert.equal(materialized.record.status, "ok");

    manager.appendCustomEntry("fixture.metadata", { source: "session-ui" });
    const active = SessionManager.open(sessionFile, sessionRoot);
    const loaded = await readRarebitSession(sessionFile, { sessionRoot });
    const current = await readRarebitCurrent({
      sessionFile,
      sessionRoot,
      rarebitRoot,
    });
    assert.equal(loaded.branch.at(-1)?.id, active.getLeafId());
    assert.equal(loaded.branch.at(-1)?.type, "custom");
    assert.notEqual(materialized.record.branch.leafId, active.getLeafId());
    assert.equal(
      loaded.selection.manifestHash,
      materialized.record.selection.manifestHash,
    );
    assert.equal(current.artifactState.syncState, "assessment_current");
    assert.equal(current.artifactState.applicability, "exact_selection");
    assert.equal(
      current.artifactState.receiptRef.jobId,
      materialized.record.jobId,
    );

    const widgets = [];
    const controller = createRarebitRecapController({ delayMs: 0 });
    const activeContext = {
      ...baseContext,
      ui: { setWidget: (...args) => widgets.push(args) },
      sessionManager: active,
    };
    const shown = await controller.showExisting(activeContext, {
      sessionRoot,
      rarebitRoot,
    });
    assert.equal(shown.shown, true);
    assert.equal(shown.reason, "current_summary");
    assert.equal(widgets.at(-1)[0], RAREBIT_RECAP_WIDGET_KEY);

    active.appendMessage({
      role: "user",
      content: [{ type: "text", text: "selection changed" }],
      timestamp: timestamp + 2,
    });
    const changed = SessionManager.open(sessionFile, sessionRoot);
    const changedLoaded = await readRarebitSession(sessionFile, {
      sessionRoot,
    });
    assert.notEqual(
      changedLoaded.selection.manifestHash,
      loaded.selection.manifestHash,
    );
    const rejected = await controller.showExisting(
      { ...activeContext, sessionManager: changed },
      { sessionRoot, rarebitRoot },
    );
    assert.equal(rejected.shown, false);
    assert.equal(rejected.reason, "materialization_pending");
    assert.equal(widgets.at(-1)[1], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension lifecycle materializes a real sidecar and arms the widget without Session prose", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-recap-extension-"));
  const sessionRoot = join(root, "sessions");
  const rarebitRoot = join(root, "rarebit");
  const sessionFile = join(sessionRoot, "session.jsonl");
  const branch = branchFor().map((entry, index, entries) => ({
    ...entry,
    parentId: index === 0 ? null : entries[index - 1].id,
    timestamp: `2026-09-27T00:00:0${index}.000Z`,
  }));
  await (await import("node:fs/promises")).mkdir(sessionRoot, { recursive: true });
  await writeFile(
    sessionFile,
    `${[
      {
        type: "session",
        version: 3,
        id: "session-1",
        cwd: root,
      },
      ...branch,
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")}\n`,
    { mode: 0o600 },
  );

  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const notices = [];
  let providerCalls = 0;
  let releaseDelayedProvider;
  let markProviderStarted;
  const delayedProviderStarted = new Promise((resolve) => { markProviderStarted = resolve; });
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    getSessionName: () => "synthetic recap session",
    events: { emit() {} },
  };
  registerPiRarebit(pi, {
    sessionRoot,
    rarebitRoot,
    model: { provider: "test", id: "summary-model" },
    summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
    recap: { delayMs: 1 },
    settingsLoader: async () => ({
      autoTitle: false,
      recap: { enabled: true, delayMs: 1 },
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
    }),
    queryAutomaticSummaryPolicy: async () => ({
      decision: "abstain",
      queryStatus: "test",
    }),
    modelClient: {
      complete: async () => {
        providerCalls += 1;
        if (providerCalls === 3) {
          markProviderStarted();
          return new Promise((resolve) => { releaseDelayedProvider = () => resolve({
            text: JSON.stringify({ summary: "Delayed synthetic assessment", sessionStatus: "finished", statusReason: "all_requests_accomplished" }),
          }); });
        }
        return {
          text: JSON.stringify({
            summary: "RECAP_SENTINEL: generated only for the sidecar",
            sessionStatus: "finished",
            statusReason: "all_requests_accomplished",
          }),
        };
      },
    },
    activityReporter: {
      start() {},
      update() {},
      stop() {},
    },
  });
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    sessionId: "session-1",
    model: { provider: "test", id: "summary-model" },
    isProjectTrusted: () => true,
    ui: {
      setWidget: (...args) => widgets.push(args),
      notify: (text, level) => notices.push({ text, level }),
    },
    sessionManager: {
      getHeader: () => ({ id: "session-1" }),
      getSessionFile: () => sessionFile,
      getBranch: () => branch,
    },
  };
  try {
    handlers.get("session_start")({}, ctx);
    handlers.get("agent_start")({}, ctx);
    handlers.get("agent_end")(
      { messages: [branch.at(-1).message] },
      ctx,
    );
    handlers.get("agent_settled")({}, ctx);
    const deadline = Date.now() + 2_000;
    while (!widgets.some((call) => call[1] !== undefined)) {
      if (Date.now() > deadline) throw new Error("recap widget did not render");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(providerCalls, 1);
    const rendered = widgets.find((call) => call[1] !== undefined);
    assert.equal(rendered[0], RAREBIT_RECAP_WIDGET_KEY);
    assert.match(widgetText(rendered[1]), /RECAP_SENTINEL/);
    assert.deepEqual(rendered[2], { placement: "aboveEditor" });

    const native = await readFile(sessionFile, "utf8");
    assert.doesNotMatch(native, /RECAP_SENTINEL/);
    await commands.get("rarebit").handler("recap", ctx);
    assert.equal(providerCalls, 1, "displaying an existing recap must not synthesize");
    await commands.get("rarebit").handler("summarize", ctx);
    const manualDeadline = Date.now() + 2_000;
    while (!notices.some((item) => /updated and current/.test(item.text))) {
      if (Date.now() > manualDeadline) throw new Error("manual Summary result was not reported");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(providerCalls, 2);
    await commands.get("rarebit").handler("summarize", ctx);
    const duplicateDeadline = Date.now() + 2_000;
    while (!notices.some((item) => /already current/.test(item.text))) {
      if (Date.now() > duplicateDeadline) throw new Error("duplicate Summary result was not reported");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(providerCalls, 2);

    branch.push({ type: "message", id: "owner-2", parentId: branch.at(-1).id,
      timestamp: "2026-09-27T00:00:03.000Z", message: { role: "user", content: "Synthetic request for delayed currentness check" } });
    await writeFile(sessionFile, `${[{ type: "session", version: 3, id: "session-1", cwd: root }, ...branch].map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
    await commands.get("rarebit").handler("summarize", ctx);
    await delayedProviderStarted;
    const nextContext = {
      ...ctx,
      sessionId: "session-2",
      sessionManager: {
        getHeader: () => ({ id: "session-2" }),
        getSessionFile: () => join(sessionRoot, "session-2.jsonl"),
        getBranch: () => branchFor("session-2-assistant"),
      },
    };
    handlers.get("session_start")({}, nextContext);
    releaseDelayedProvider();
    const staleDeadline = Date.now() + 2_000;
    while (!notices.some((item) => /generated but is not current/.test(item.text))) {
      if (Date.now() > staleDeadline) throw new Error("session-switched Summary result was not reported as non-current");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(notices.at(-1).level, "warning");
    assert.equal(providerCalls, 3);
  } finally {
    handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("settings preserve a global recap disable when a trusted project overrides only the delay", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-recap-settings-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      rarebit: {
        model: "test/summary-model",
        recap: { enabled: false },
      },
    }),
  );
  await writeFile(
    join(projectDir, ".pi", "settings.json"),
    JSON.stringify({ rarebit: { recap: { delay_ms: 123 } } }),
  );
  try {
    const settings = await readConfiguredRarebitSettings({
      cwd: projectDir,
      projectTrusted: true,
      model: { provider: "test", id: "summary-model" },
      agentDir,
    });
    assert.equal(settings.recap.enabled, false);
    assert.equal(settings.recap.delayMs, 123);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function widgetText(factory) {
  return factory({ requestRender() {} }, { fg: (_name, text) => text }).render(160).join("\n");
}
