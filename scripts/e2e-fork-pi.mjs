#!/usr/bin/env node
/**
 * Privacy-safe Rarebit fork canary.
 *
 * This script uses only synthetic Session prose and disposable Pi roots. It
 * exercises the public fork construction/PiQ boundary with real Pi SDK hosts.
 * It never reads or switches the owner's active Session.
 */
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildRarebitForkPlan,
  createRarebitForkEntries,
  sessionFilenameFor,
  writeRarebitForkFile,
} from "../src/rarebit-fork.mjs";
import {
  getImportedRarebitEntryIds,
  getRarebitForkLineageRecords,
} from "../src/rarebit-fork-lineage.mjs";
import { parseNativeSession, readPiSession } from "../src/pi-session.mjs";
import { parseRarebitCommand } from "../src/rarebit-command.mjs";
import { queryPiQ } from "../src/piq.mjs";
import registerPiRarebit from "../src/extension.mjs";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const childPiRoot = resolve(packageRoot, "node_modules/@earendil-works/pi-coding-agent");
const installedPiRoot = process.env.RAREBIT_INSTALLED_PI_ROOT
  ? resolve(process.env.RAREBIT_INSTALLED_PI_ROOT)
  : null;
if (!installedPiRoot)
  throw new Error("RAREBIT_INSTALLED_PI_ROOT must name the installed Pi coding-agent package root for this canary");
const expectedChildVersion = process.env.RAREBIT_CHILD_PI_VERSION ?? "0.84.2";
const expectedInstalledVersion =
  process.env.RAREBIT_INSTALLED_PI_VERSION ?? "0.86.1";

const SOURCE_CWD = "/synthetic/rarebit-source";
const TARGET_CWD = "/synthetic/rarebit-target";
const sourceHeader = {
  type: "session",
  version: 3,
  id: "source-session-synthetic",
  timestamp: "2026-09-21T00:00:00.000Z",
  cwd: SOURCE_CWD,
};

function message(id, parentId, timestamp, value) {
  return { type: "message", id, parentId, timestamp, message: value };
}

function syntheticSource() {
  const entries = [
    message("u-old", null, "2026-09-21T00:00:01.000Z", {
      role: "user",
      content: "old source request omitted by the bounded budget",
    }),
    message("a-tool", "u-old", "2026-09-21T00:00:02.000Z", {
      role: "assistant",
      content: [
        { type: "text", text: "assistant continuation retained for recovery" },
        {
          type: "toolCall",
          id: "tool-call-synthetic",
          name: "lookup",
          arguments: { query: "synthetic" },
        },
      ],
      stopReason: "toolUse",
      usage: { input: 19, output: 4, totalTokens: 23 },
    }),
    message("tool-result", "a-tool", "2026-09-21T00:00:03.000Z", {
      role: "toolResult",
      toolCallId: "tool-call-synthetic",
      content: [{ type: "text", text: "synthetic omitted tool result" }],
    }),
    message("a-stop-1", "tool-result", "2026-09-21T00:00:04.000Z", {
      role: "assistant",
      content: [{ type: "text", text: "first consecutive assistant prose" }],
      stopReason: "stop",
      usage: { input: 21, output: 5, totalTokens: 26 },
    }),
    message("a-stop-2", "a-stop-1", "2026-09-21T00:00:05.000Z", {
      role: "assistant",
      content: [{ type: "text", text: "second consecutive assistant prose" }],
      stopReason: "stop",
      usage: { input: 22, output: 5, totalTokens: 27 },
    }),
    message("u-new", "a-stop-2", "2026-09-21T00:00:06.000Z", {
      role: "user",
      content: "newest retained user request",
    }),
  ];
  return { header: sourceHeader, entries };
}

function serializedSession(session) {
  return `${[session.header, ...session.entries]
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
}

async function piPackage(root) {
  const packagePath = join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const pi = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const faux = await import(
    pathToFileURL(
      join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"),
    ).href,
  );
  return { packageJson, pi, faux };
}

async function assertStaticForkContracts(root) {
  assert.equal(parseRarebitCommand("fork").ok, true);
  assert.equal(parseRarebitCommand("fork --max-token-length 64000").ok, true);
  const source = syntheticSource();
  const sourceFile = join(root, "source.jsonl");
  const sourceBytes = serializedSession(source);
  await writeFile(sourceFile, sourceBytes, { mode: 0o600 });

  const sourceBranch = (await readPiSession(sourceFile)).branch;
  const plan = buildRarebitForkPlan({
    header: source.header,
    sessionFile: sourceFile,
    cwd: SOURCE_CWD,
    branch: sourceBranch,
    targetCwd: TARGET_CWD,
    targetModel: { contextWindow: 128_000 },
    maxTokenLength: 40,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T01:00:00.000Z",
  });
  assert.equal(plan.selected.at(-1).sourceEntryId, "u-new");
  assert.deepEqual(plan.selected.map(({ sourceEntryId }) => sourceEntryId), ["a-tool", "a-stop-1", "a-stop-2", "u-new"]);
  assert.equal(plan.selected.some(({ sourceEntryId }) => sourceEntryId === "u-old"), false);
  assert.equal(plan.selected.some(({ sourceEntryId }) => sourceEntryId === "a-tool"), true);
  assert.equal(plan.selected.some(({ sourceEntryId }) => sourceEntryId === "a-stop-1"), true);
  assert.equal(plan.selected.some(({ sourceEntryId }) => sourceEntryId === "a-stop-2"), true);
  assert.equal(plan.selected.some(({ sourceEntryId }) => sourceEntryId === "tool-result"), false);

  const fork = createRarebitForkEntries(plan, {
    sessionId: "fork-session-synthetic",
  });
  const forkFile = join(root, "fork.jsonl");
  await writeRarebitForkFile(forkFile, fork);
  assert.equal(await readFile(sourceFile, "utf8"), sourceBytes, "fork must not mutate source");

  const parsedFork = parseNativeSession(await readFile(forkFile, "utf8"), forkFile);
  assert.deepEqual(
    parsedFork.entries.map((entry) => entry.parentId),
    parsedFork.entries.map((entry, index) => index === 0 ? null : parsedFork.entries[index - 1].id),
    "fork must have one valid linear parent chain",
  );
  const importedIds = getImportedRarebitEntryIds(parsedFork.entries);
  assert.equal(importedIds.size, plan.selected.length + 1, "seed and imports must be excluded from fresh activity");
  assert.equal(getRarebitForkLineageRecords(parsedFork.entries).length, 1);

  const imported = parsedFork.entries.filter((entry) => importedIds.has(entry.id));
  assert.deepEqual(
    imported.map((entry) => entry.timestamp),
    imported.map(() => plan.forkCreatedAt),
    "fork timestamps describe creation",
  );
  const mappings = getRarebitForkLineageRecords(parsedFork.entries)[0].mappings;
  assert.ok(mappings.every((mapping) => typeof mapping.originalTimestamp === "string"));
  assert.equal(
    imported.find((entry) => entry.rarebitFork?.sourceEntryId === "a-tool")?.message.stopReason,
    "toolUse",
  );
  assert.equal(
    imported.filter((entry) => entry.message?.role === "assistant").length,
    3,
    "assistant continuation and consecutive prose must remain assistant messages",
  );
  assert.ok(imported.every((entry) => !entry.message?.usage || Object.values(entry.message.usage).every((value) => value === 0 || (typeof value === "object" && Object.values(value).every((nested) => nested === 0)))));

  const secondSource = await readPiSession(forkFile);
  const secondPlan = buildRarebitForkPlan({
    header: secondSource.parsed.header,
    sessionFile: forkFile,
    cwd: TARGET_CWD,
    branch: secondSource.branch,
    targetCwd: "/synthetic/rarebit-third",
    targetModel: { contextWindow: 128_000 },
    maxTokenLength: 80,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T02:00:00.000Z",
  });
  const importedConversation = imported.filter((entry) => entry.rarebitFork?.kind === "import");
  assert.equal(secondPlan.selected.some((item) => item.sourceEntryId === importedConversation[0].id), true);
  assert.equal(secondPlan.selected.some((item) => item.sourceEntryId === parsedFork.entries[0].id), false, "generated opening notice must not be imported into a repeated fork");
  const secondFork = createRarebitForkEntries(secondPlan, { sessionId: "fork-session-third-synthetic" });
  assert.equal(secondFork.entries.filter((entry) => entry.rarebitFork?.kind === "seed").length, 1, "repeated forks must generate one opening notice");
  assert.ok(secondFork.manifest.mappings.every((mapping) => mapping.ancestry.some((source) => source.sessionId === sourceHeader.id)), "repeated fork lineage must retain original source Session coordinates");
  const thirdPlan = buildRarebitForkPlan({
    header: secondFork.header,
    sessionFile: "/synthetic/rarebit-third.jsonl",
    cwd: "/synthetic/rarebit-third",
    branch: secondFork.entries.slice(0, -1),
    targetCwd: "/synthetic/rarebit-fourth",
    targetModel: { contextWindow: 128_000 },
    maxTokenLength: 80,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T02:30:00.000Z",
  });
  const thirdFork = createRarebitForkEntries(thirdPlan, { sessionId: "fork-session-fourth-synthetic" });
  assert.ok(thirdFork.manifest.mappings.every((mapping) => mapping.ancestry.length === 3), "depth-three repeated fork ancestry must remain explicit");

  const v1File = join(root, "legacy-v1.jsonl");
  const v1Bytes = `${JSON.stringify({ type: "session", version: 1, id: "legacy-v1", cwd: SOURCE_CWD })}\n${JSON.stringify({ type: "message", message: { role: "user", content: "legacy" } })}\n`;
  await writeFile(v1File, v1Bytes);
  assert.equal((await readPiSession(v1File)).branch.length, 1);
  assert.equal(await readFile(v1File, "utf8"), v1Bytes, "v1 source must remain unchanged");
  const v2File = join(root, "legacy-v2.jsonl");
  const v2Records = [
    { type: "session", version: 2, id: "legacy-v2", cwd: SOURCE_CWD },
    { type: "message", id: "v2-root", parentId: null, message: { role: "user", content: "root" } },
    { type: "message", id: "v2-leaf", parentId: "v2-root", message: { role: "assistant", stopReason: "stop", content: "leaf" } },
    { type: "message", id: "v2-sibling", parentId: "v2-root", message: { role: "user", content: "sibling" } },
  ];
  const v2Bytes = `${v2Records.map(JSON.stringify).join("\n")}\n`;
  await writeFile(v2File, v2Bytes);
  assert.deepEqual((await readPiSession(v2File)).branch.map((entry) => entry.id), ["v2-root", "v2-sibling"]);
  assert.equal(await readFile(v2File, "utf8"), v2Bytes, "v2 source must remain unchanged");

  const atomicTarget = join(root, "atomic-failure.jsonl");
  await assert.rejects(
    writeRarebitForkFile(atomicTarget, fork, {
      renameImpl: async () => { throw new Error("synthetic rename failure"); },
    }),
    /synthetic rename failure/,
  );
  await assert.rejects(readFile(atomicTarget, "utf8"));
  assert.equal((await readdir(root)).some((name) => name.includes("atomic-failure") && name.endsWith(".tmp")), false, "failed setup must clean temporary output");
  assert.match(sessionFilenameFor({ sessionDir: root, forkCreatedAt: plan.forkCreatedAt, sessionId: fork.sessionId }), /fork-session-synthetic\.jsonl$/);

  const toolPlan = buildRarebitForkPlan({
    header: source.header,
    sessionFile: sourceFile,
    cwd: SOURCE_CWD,
    branch: sourceBranch.slice(0, 2),
    targetCwd: TARGET_CWD,
    targetModel: { contextWindow: 128_000 },
    maxTokenLength: 20,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T03:00:00.000Z",
  });
  assert.deepEqual(toolPlan.selected.map(({ sourceEntryId }) => sourceEntryId), ["a-tool"]);
  const toolFork = createRarebitForkEntries(toolPlan, { sessionId: "fork-session-tool-synthetic" });
  const toolForkFile = join(root, "fork-tool.jsonl");
  await writeRarebitForkFile(toolForkFile, toolFork);

  const assistantPlan = buildRarebitForkPlan({
    header: source.header,
    sessionFile: sourceFile,
    cwd: SOURCE_CWD,
    branch: sourceBranch.slice(0, 5),
    targetCwd: TARGET_CWD,
    targetModel: { contextWindow: 128_000 },
    maxTokenLength: 39,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T04:00:00.000Z",
  });
  assert.deepEqual(assistantPlan.selected.map(({ sourceEntryId }) => sourceEntryId), ["a-tool", "a-stop-1", "a-stop-2"]);
  const assistantFork = createRarebitForkEntries(assistantPlan, { sessionId: "fork-session-assistant-synthetic" });
  const assistantForkFile = join(root, "fork-assistant.jsonl");
  await writeRarebitForkFile(assistantForkFile, assistantFork);

  const sentinelPlan = buildRarebitForkPlan({
    header: source.header,
    sessionFile: sourceFile,
    cwd: SOURCE_CWD,
    branch: sourceBranch.slice(0, 5),
    targetCwd: TARGET_CWD,
    targetModel: { provider: "sentinel", id: "sentinel-model", contextWindow: 128_000 },
    maxTokenLength: 40,
    reserveTokens: 4_096,
    forkCreatedAt: "2026-09-21T05:00:00.000Z",
  });
  const sentinelFork = createRarebitForkEntries(sentinelPlan, { sessionId: "fork-session-sentinel-synthetic" });
  const sentinelForkFile = join(root, "fork-sentinel.jsonl");
  await writeRarebitForkFile(sentinelForkFile, sentinelFork);

  const truncated = join(root, "truncated.jsonl");
  await writeFile(truncated, `${sourceBytes}{"type":"message","id":"partial"`);
  await assert.rejects(readPiSession(truncated), /malformed JSON/);

  await assert.rejects(
    (async () => {
      buildRarebitForkPlan({
        header: source.header,
        sessionFile: sourceFile,
        cwd: SOURCE_CWD,
        branch: sourceBranch,
        targetCwd: TARGET_CWD,
        targetModel: { contextWindow: 100 },
        maxTokenLength: 40,
        reserveTokens: 99,
        forkCreatedAt: "2026-09-21T01:00:00.000Z",
      });
    })(),
    /headroom|reserve/i,
  );

  return {
    sourceFile,
    forkFile,
    sourceBytes,
    fork,
    toolForkFile,
    assistantForkFile,
    sentinelForkFile,
    legacyFiles: [v1File, v2File],
  };
}

async function runCliCanary(root, sourceFiles) {
  const cliHome = join(root, "cli-home");
  const cliAgent = join(root, "cli-agent");
  const cliCwd = join(root, "cli-cwd");
  await Promise.all([mkdir(cliHome, { recursive: true }), mkdir(cliAgent, { recursive: true }), mkdir(cliCwd, { recursive: true })]);
  const { pi: childPi } = await piPackage(childPiRoot);
  const cliRuntime = await childPi.ModelRuntime.create({ modelsPath: null });
  const cliModel = cliRuntime
    .getModels()
    .find((model) => Number.isFinite(model.contextWindow) && model.contextWindow > 0);
  assert.ok(cliModel, "child Pi must expose a context-bearing model for CLI verification");
  await writeFile(join(cliAgent, "settings.json"), JSON.stringify({
    defaultProvider: cliModel.provider,
    defaultModel: cliModel.id,
  }));
  const outputs = [];
  for (const [index, sourceFile] of sourceFiles.entries()) {
    const sourceBytes = await readFile(sourceFile, "utf8");
    const result = spawnSync(
      process.execPath,
      [join(packageRoot, "bin/rarebit.mjs"), "fork", sourceFile, "--max-token-length", "40", "--no-launch", "--json"],
      { cwd: cliCwd, env: { ...process.env, HOME: cliHome, PI_CODING_AGENT_DIR: cliAgent }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.operation, "fork");
    assert.equal(payload.launched, false);
    assert.match(payload.session, new RegExp(`^${cliAgent.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/sessions/`));
    assert.equal(await readFile(sourceFile, "utf8"), sourceBytes, `CLI fork ${index} must not mutate source`);
    assert.ok((await readFile(payload.session, "utf8")).includes("rarebit_fork_lineage"));
    outputs.push(payload);
  }
  const launcher = join(cliCwd, "controlled-pi-launch.sh");
  const launchMarker = join(cliCwd, "launch-argv.txt");
  await writeFile(launcher, `#!/bin/sh\nprintf '%s\\n' "$@" > ${launchMarker}\nexit 0\n`);
  await chmod(launcher, 0o700);
  const cliModule = pathToFileURL(resolve(packageRoot, "src/rarebit-cli.mjs")).href;
  const launchCode = `import { parseRarebitCliArgs, runRarebitCli } from ${JSON.stringify(cliModule)};\nconst options = parseRarebitCliArgs(["fork", process.env.CANARY_SOURCE, "--max-token-length", "40", "--json"]);\nconst result = await runRarebitCli(options, { piCommand: process.env.CANARY_PI_COMMAND, resolveTarget: async () => ({ model: { provider: "synthetic", id: "controlled", contextWindow: 128000 }, reserveTokens: 4096, promptOverheadTokens: 0, toolOverheadTokens: 0 }) });\nprocess.stdout.write(JSON.stringify(result));`;
  const launched = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", launchCode],
    { cwd: cliCwd, env: { ...process.env, HOME: cliHome, PI_CODING_AGENT_DIR: cliAgent, CANARY_SOURCE: sourceFiles[0], CANARY_PI_COMMAND: launcher }, encoding: "utf8" },
  );
  assert.equal(launched.status, 0, launched.stderr);
  const launchPayload = JSON.parse(launched.stdout);
  assert.equal(launchPayload.launched, true);
  assert.equal(launchPayload.exitCode, 0);
  assert.match(await readFile(launchMarker, "utf8"), /--session/);
  assert.ok((await readFile(launchPayload.session, "utf8")).includes("rarebit_fork_lineage"));
  return { session: outputs[0].session, cwd: cliCwd, legacyCount: outputs.length - 1, launched: true };
}

async function runSlashCanary(root, sourceFile, sourceBytes) {
  const { packageJson, pi, faux } = await piPackage(root);
  const provider = faux.fauxProvider({
    provider: `rarebit-slash-${packageJson.version}`,
    models: [{ id: "controlled", contextWindow: 128_000, maxTokens: 256, input: ["text"] }],
  });
  const settings = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
  const runtime = await pi.ModelRuntime.create({ modelsPath: null });
  runtime.registerNativeProvider(provider.provider);
  const slashSource = join(dirname(sourceFile), "slash-source-copy.jsonl");
  await writeFile(slashSource, sourceBytes);
  const manager = pi.SessionManager.open(slashSource, join(dirname(sourceFile), "slash-sessions"), TARGET_CWD);
  const loader = new pi.DefaultResourceLoader({
    cwd: TARGET_CWD,
    agentDir: join(dirname(sourceFile), "slash-agent"),
    settingsManager: settings,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (extensionPi) => registerPiRarebit(extensionPi, {
        settingsLoader: async () => ({ summaryPolicy: {}, autoTitle: false }),
      }),
    ],
  });
  await loader.reload();
  const { session, extensionsResult } = await pi.createAgentSession({
    cwd: TARGET_CWD,
    agentDir: join(dirname(sourceFile), "slash-agent"),
    model: provider.getModel(),
    modelRuntime: runtime,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: settings,
  });
  let switchedPath;
  const command = extensionsResult.extensions
    .flatMap((extension) => [...extension.commands.values()])
    .find((candidate) => candidate.name === "rarebit");
  assert.ok(command, "real Pi SDK must register the Rarebit slash command");
  try {
    await command.handler("fork --max-token-length 40", {
      cwd: TARGET_CWD,
      model: provider.getModel(),
      sessionManager: manager,
      waitForIdle: async () => {},
      getSystemPrompt: () => "synthetic system prompt",
      hasUI: false,
      ui: { notify: () => {} },
      switchSession: async (destination, options) => {
        switchedPath = destination;
        await options?.withSession?.({ hasUI: false, ui: { notify: () => {} } });
        return { cancelled: false };
      },
    });
    assert.equal(provider.state.callCount, 0, "slash fork must not start a model turn");
    assert.equal(typeof switchedPath, "string");
    assert.ok((await readFile(switchedPath, "utf8")).includes("rarebit_fork_lineage"));
    assert.equal(await readFile(sourceFile, "utf8"), sourceBytes, "slash fork must not mutate source");
    await rm(switchedPath, { force: true });
    switchedPath = undefined;
    const refusalNotices = [];
    await command.handler("fork --max-token-length 40", {
      cwd: TARGET_CWD,
      model: null,
      sessionManager: manager,
      waitForIdle: async () => {},
      getSystemPrompt: () => "synthetic system prompt",
      hasUI: true,
      ui: { notify: (text) => refusalNotices.push(text) },
      switchSession: async (destination) => {
        switchedPath = destination;
        return { cancelled: false };
      },
    });
    assert.equal(switchedPath, undefined, "unknown model/window must refuse before switching");
    assert.ok(refusalNotices.some((text) => /model|context|window|headroom/i.test(text)));
  } finally {
    if (switchedPath) await rm(switchedPath, { force: true });
    session.dispose();
    runtime.unregisterProvider(provider.provider);
  }
  return { host: packageJson.version };
}

async function runPiHost(
  root,
  expectedVersion,
  forkFile,
  sessionsRoot,
  expectedTexts,
) {
  const { packageJson, pi, faux } = await piPackage(root);
  assert.equal(packageJson.version, expectedVersion, `unexpected Pi host at ${root}`);
  const provider = faux.fauxProvider({
    provider: `rarebit-canary-${packageJson.version}`,
    models: [
      {
        id: "controlled",
        contextWindow: 128_000,
        maxTokens: 256,
        input: ["text"],
      },
    ],
  });
  const observedContexts = [];
  provider.setResponses([
    (context) => {
      observedContexts.push(context);
      return faux.fauxAssistantMessage("synthetic continuation");
    },
  ]);
  await mkdir(sessionsRoot, { recursive: true });
  const manager = pi.SessionManager.open(forkFile, sessionsRoot, TARGET_CWD);
  const runtime = await pi.ModelRuntime.create({ modelsPath: null });
  runtime.registerNativeProvider(provider.provider);
  const settings = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new pi.DefaultResourceLoader({
    cwd: TARGET_CWD,
    agentDir: sessionsRoot,
    settingsManager: settings,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const { session } = await pi.createAgentSession({
    cwd: TARGET_CWD,
    agentDir: sessionsRoot,
    model: provider.getModel(),
    modelRuntime: runtime,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: settings,
  });
  try {
    assert.equal(provider.state.callCount, 0, "fork setup must not call a provider");
    const before = session.getContextUsage();
    assert.ok(before?.tokens > 0, "real Pi context occupancy must be positive");
    const importedBranchEntries = manager
      .getBranch()
      .filter((entry) => entry.rarebitFork?.kind === "import");
    assert.ok(
      importedBranchEntries.every((entry) => {
        const usage = entry.message?.usage;
        return !usage || Object.values(usage).every((value) =>
          typeof value === "object"
            ? Object.values(value).every((nested) => nested === 0)
            : value === 0,
        );
      }),
      "imported messages must carry only zero usage",
    );
    await session.prompt("continue the synthetic imported evidence");
    await session.agent.waitForIdle();
    assert.equal(provider.state.callCount, 1, "continuation must make one provider call");
    assert.equal(observedContexts.length, 1);
    const contextText = JSON.stringify(observedContexts[0]);
    for (const text of expectedTexts) assert.match(contextText, new RegExp(text));
    assert.doesNotMatch(contextText, /synthetic omitted tool result/);
    const after = session.getContextUsage();
    assert.ok(after?.tokens > 0, "context occupancy must remain positive after continuation");
    return { packageVersion: packageJson.version, before, after, manager, sourceToolId: "tool-result" };
  } finally {
    session.dispose();
    runtime.unregisterProvider(provider.provider);
  }
}

async function runSentinelRestoreHost(root, expectedVersion, forkFile, sessionsRoot) {
  const { packageJson, pi, faux } = await piPackage(root);
  assert.equal(packageJson.version, expectedVersion);
  const provider = faux.fauxProvider({
    provider: "sentinel",
    models: [{ id: "sentinel-model", contextWindow: 128_000, maxTokens: 256, input: ["text"] }],
  });
  provider.setResponses([faux.fauxAssistantMessage("sentinel restored continuation")]);
  const runtime = await pi.ModelRuntime.create({ modelsPath: null });
  runtime.registerNativeProvider(provider.provider);
  await runtime.setRuntimeApiKey(provider.provider, "synthetic");
  // Faux has no native credential provider. Mark only this disposable runtime
  // as configured so SDK restore exercises model_change resolution itself.
  runtime.hasConfiguredAuth = () => true;
  const manager = pi.SessionManager.open(forkFile, sessionsRoot, TARGET_CWD);
  const settings = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new pi.DefaultResourceLoader({ cwd: TARGET_CWD, agentDir: sessionsRoot, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const { session } = await pi.createAgentSession({
    cwd: TARGET_CWD,
    agentDir: sessionsRoot,
    modelRuntime: runtime,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: settings,
  });
  try {
    assert.equal(session.model?.provider, "sentinel", "native model_change must restore provider");
    assert.equal(session.model?.id, "sentinel-model", "native model_change must restore model");
    const imported = manager.getEntries().filter((entry) => entry.rarebitFork?.kind === "import");
    assert.ok(imported.every((entry) => !entry.message.usage || Object.values(entry.message.usage).every((value) =>
      typeof value === "object" ? Object.values(value).every((nested) => nested === 0) : value === 0,
    )));
    const stats = session.getSessionStats();
    assert.equal(stats.cost, 0, "zero imported usage must aggregate without sentinel cost faults");
    assert.ok(session.getContextUsage()?.tokens > 0, "restored sentinel context must remain occupied");
    await session.prompt("continue after native model restoration");
    await session.agent.waitForIdle();
    assert.ok(provider.state.callCount >= 1, "restored model must support continuation");
    assert.equal(session.getSessionStats().cost, 0);
    return { packageVersion: packageJson.version, restored: true };
  } finally {
    session.dispose();
    runtime.unregisterProvider(provider.provider);
  }
}

async function makeRealColdFork(root, sourceFile) {
  const configured = process.env.RAREBIT_REAL_PROVIDER;
  if (!configured) return { status: "skipped", reason: "RAREBIT_REAL_PROVIDER_not_set" };
  const separator = configured.indexOf("/");
  if (separator <= 0 || separator === configured.length - 1)
    return { status: "unavailable", reason: "invalid_provider_spec" };
  const providerId = configured.slice(0, separator);
  const modelId = configured.slice(separator + 1);
  try {
    const { pi } = await piPackage(installedPiRoot);
    const runtime = await pi.ModelRuntime.create({ modelsPath: null });
    const model = runtime.getModel(providerId, modelId);
    if (!model) return { status: "unavailable", reason: "configured_model_not_found" };
    if (!runtime.hasConfiguredAuth(providerId)) return { status: "unavailable", reason: "configured_model_auth_unavailable" };
    const loaded = await readPiSession(sourceFile);
    const plan = buildRarebitForkPlan({
      header: loaded.parsed.header,
      sessionFile: sourceFile,
      cwd: SOURCE_CWD,
      branch: loaded.branch.slice(0, 5),
      targetCwd: TARGET_CWD,
      targetModel: model,
      maxTokenLength: 39,
      reserveTokens: 4_096,
      forkCreatedAt: "2026-09-21T06:00:00.000Z",
    });
    const fork = createRarebitForkEntries(plan, { sessionId: "fork-session-real-cold-synthetic" });
    const forkFile = join(root, "fork-real-cold.jsonl");
    await writeRarebitForkFile(forkFile, fork);
    return { status: "ready", forkFile, model: { provider: model.provider, id: model.id } };
  } catch (error) {
    return { status: "unavailable", reason: error?.name === "AuthenticationError" ? "provider_auth" : "model_resolution" };
  }
}

async function runInstalledRealColdRestore(cold, sourceFile, sourceBytes, sessionsRoot) {
  if (cold.status !== "ready") return cold;
  try {
    const { packageJson, pi } = await piPackage(installedPiRoot);
    const runtime = await pi.ModelRuntime.create({ modelsPath: null });
    const model = runtime.getModel(cold.model.provider, cold.model.id);
    if (!model || !runtime.hasConfiguredAuth(model.provider))
      return { status: "unavailable", reason: "cold_restore_auth_unavailable" };
    const manager = pi.SessionManager.open(cold.forkFile, sessionsRoot, TARGET_CWD);
    const settings = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new pi.DefaultResourceLoader({ cwd: TARGET_CWD, agentDir: sessionsRoot, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await loader.reload();
    const { session } = await pi.createAgentSession({
      cwd: TARGET_CWD,
      agentDir: sessionsRoot,
      modelRuntime: runtime,
      noTools: "all",
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: settings,
    });
    try {
      assert.equal(session.model?.provider, cold.model.provider, "cold restore must use native model_change provider");
      assert.equal(session.model?.id, cold.model.id, "cold restore must use native model_change model");
      assert.ok(session.getContextUsage()?.tokens > 0);
      await session.prompt("Reply with exactly CANARY_COLD_RESTORE_OK and no other text.");
      await session.agent.waitForIdle();
      assert.match(session.getLastAssistantText() ?? "", /CANARY_COLD_RESTORE_OK/);
      assert.equal(await readFile(sourceFile, "utf8"), sourceBytes, "cold restore must not mutate source");
      return { status: "passed", host: packageJson.version, model: cold.model };
    } finally {
      session.dispose();
    }
  } catch (error) {
    return { status: "failed", reason: error?.name === "AuthenticationError" ? "provider_auth" : "cold_restore_request" };
  }
}

async function runInstalledRealContinuation(
  forkFile,
  sourceFile,
  sessionsRoot,
  sourceBytes,
) {
  const configured = process.env.RAREBIT_REAL_PROVIDER;
  if (!configured) return { status: "skipped", reason: "RAREBIT_REAL_PROVIDER_not_set" };
  const separator = configured.indexOf("/");
  if (separator <= 0 || separator === configured.length - 1)
    return { status: "unavailable", reason: "invalid_provider_spec" };
  const providerId = configured.slice(0, separator);
  const modelId = configured.slice(separator + 1);
  try {
    const { packageJson, pi } = await piPackage(installedPiRoot);
    assert.equal(packageJson.version, expectedInstalledVersion);
    const runtime = await pi.ModelRuntime.create({ modelsPath: null });
    const model = runtime.getModel(providerId, modelId);
    if (!model) return { status: "unavailable", reason: "configured_model_not_found" };
    const manager = pi.SessionManager.open(forkFile, sessionsRoot, TARGET_CWD);
    const settings = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new pi.DefaultResourceLoader({
      cwd: TARGET_CWD,
      agentDir: sessionsRoot,
      settingsManager: settings,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const { session } = await pi.createAgentSession({
      cwd: TARGET_CWD,
      agentDir: sessionsRoot,
      model,
      modelRuntime: runtime,
      noTools: "all",
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: settings,
    });
    try {
      await session.prompt(
        "Reply with exactly CANARY_CONTINUATION_OK and no other text.",
      );
      await session.agent.waitForIdle();
      const reply = session.getLastAssistantText() ?? "";
      assert.match(reply, /CANARY_CONTINUATION_OK/);
      assert.equal(await readFile(sourceFile, "utf8"), sourceBytes, "real continuation must not mutate source");
      return { status: "passed", host: packageJson.version };
    } finally {
      session.dispose();
    }
  } catch (error) {
    // Keep provider/auth/network details out of the evidence artifact.
    return {
      status: "failed",
      reason: error?.name === "AuthenticationError" ? "provider_auth" : "provider_request",
    };
  }
}

async function run() {
  const root = await mkdtemp(join(tmpdir(), "rarebit-fork-canary-"));
  try {
    const { sourceFile, forkFile, sourceBytes, toolForkFile, assistantForkFile, sentinelForkFile, legacyFiles } = await assertStaticForkContracts(root);
    const cli = await runCliCanary(root, [sourceFile, ...legacyFiles]);
    const slash = await runSlashCanary(childPiRoot, sourceFile, sourceBytes);
    const childUserFork = join(root, "child-user-fork.jsonl");
    const childToolFork = join(root, "child-tool-fork.jsonl");
    const childAssistantFork = join(root, "child-assistant-fork.jsonl");
    const installedUserFork = join(root, "installed-user-fork.jsonl");
    const installedToolFork = join(root, "installed-tool-fork.jsonl");
    const installedAssistantFork = join(root, "installed-assistant-fork.jsonl");
    for (const [from, to] of [
      [forkFile, childUserFork],
      [toolForkFile, childToolFork],
      [assistantForkFile, childAssistantFork],
      [forkFile, installedUserFork],
      [toolForkFile, installedToolFork],
      [assistantForkFile, installedAssistantFork],
    ]) await writeFile(to, await readFile(from, "utf8"));
    const userExpectations = ["assistant continuation retained for recovery", "newest retained user request", "first consecutive assistant prose", "second consecutive assistant prose"];
    const toolExpectations = ["assistant continuation retained for recovery"];
    const assistantExpectations = ["assistant continuation retained for recovery", "first consecutive assistant prose", "second consecutive assistant prose"];
    const first = await runPiHost(childPiRoot, expectedChildVersion, childUserFork, join(root, "child-sessions"), userExpectations);
    await runPiHost(childPiRoot, expectedChildVersion, childToolFork, join(root, "child-tool-sessions"), toolExpectations);
    await runPiHost(childPiRoot, expectedChildVersion, childAssistantFork, join(root, "child-assistant-sessions"), assistantExpectations);
    const second = await runPiHost(installedPiRoot, expectedInstalledVersion, installedUserFork, join(root, "installed-sessions"), userExpectations);
    await runPiHost(installedPiRoot, expectedInstalledVersion, installedToolFork, join(root, "installed-tool-sessions"), toolExpectations);
    await runPiHost(installedPiRoot, expectedInstalledVersion, installedAssistantFork, join(root, "installed-assistant-sessions"), assistantExpectations);
    await runSentinelRestoreHost(childPiRoot, expectedChildVersion, sentinelForkFile, join(root, "child-sentinel-sessions"));
    await runSentinelRestoreHost(installedPiRoot, expectedInstalledVersion, sentinelForkFile, join(root, "installed-sentinel-sessions"));
    const real = await runInstalledRealContinuation(
      installedUserFork,
      sourceFile,
      join(root, "real-sessions"),
      sourceBytes,
    );
    if (real.status === "failed")
      throw new Error(`configured provider continuation failed (${real.reason})`);
    const coldPlan = await makeRealColdFork(root, sourceFile);
    const realCold = await runInstalledRealColdRestore(
      coldPlan,
      sourceFile,
      sourceBytes,
      join(root, "real-cold-sessions"),
    );
    if (realCold.status === "failed")
      throw new Error(`configured provider cold restore failed (${realCold.reason})`);
    const recovered = await queryPiQ(sourceFile, {
      kind: "tools",
      entryId: "tool-result",
      sessionRoot: join(root, "unused-session-root"),
    });
    assert.equal(recovered.length, 1, "PiQ must recover the omitted tool result");
    assert.equal(recovered[0]._piq.kind, "tool-result");
    console.log(
      JSON.stringify({
        canary: "rarebit-fork-pi",
        status: "passed",
        hosts: [first.packageVersion, second.packageVersion],
        realProvider: real,
        realColdRestore: realCold,
        checks: [
          "source-unchanged",
          "linear-fork-lineage",
          "fork-time-timestamps-with-original-lineage",
          "toolUse-stop-and-consecutive-assistant-retention",
          "zero-imported-usage-positive-context-occupancy",
          "no-provider-call-before-continuation",
          "piq-omitted-tool-result-recovery",
          "partial-entry-rejection",
          "headroom-refusal-before-switch",
          "v1-v2-source-unchanged",
          "atomic-setup-failure-cleanup",
          "normal-storage-filename",
          "slash-command-grammar",
          "cli-cwd-storage-and-no-launch",
          "cli-default-launch",
          "sentinel-model-restore-zero-usage",
          "depth-three-lineage",
        ],
      },
      null,
      2,
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
