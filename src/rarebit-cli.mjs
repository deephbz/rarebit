import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRarebitSettings } from "./rarebit-settings.mjs";
import {
  processRarebitSummary,
  processRarebitTitle,
} from "./rarebit-service.mjs";
import {
  extractRarebits,
  queryRarebits,
  readRarebitSession,
} from "./rarebit-session.mjs";
import {
  buildRarebitForkPlan,
  createRarebitForkEntries,
  sessionFilenameFor,
  writeRarebitForkFile,
} from "./rarebit-fork.mjs";

export const RAREBIT_CLI_USAGE = `Usage:
  rarebit query --session <exact-path-or-id> --json
  rarebit extract --session <exact-path-or-id> --json
  rarebit summarize --session <exact-path-or-id> [--force] [--model-command <executable> [--model-arg <arg>]] --json
  rarebit title --session <exact-path-or-id> [--date YYYY-MM-DD] [--model-command <executable> [--model-arg <arg>]] --json
  rarebit fork <exact-source-path-or-id> [--max-token-length <tokens>] [--no-launch] [--json]

Normal summarize/title resolve rarebit.model from Pi settings. The optional model-command
adapter receives one prompt on stdin and must write only model text to stdout.
query is metadata-only; extract exposes raw selected Rarebit prose on demand.`;

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

export function parseRarebitCliArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [command, ...rest] = argv;
  if (!new Set(["query", "extract", "summarize", "title", "fork"]).has(command))
    throw new Error(
      "First argument must be query, extract, summarize, or title",
    );
  const options = { command, modelArgs: [], json: false, force: false, noLaunch: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    switch (argument) {
      case "--session":
        options.session = requiredValue(rest, index, argument);
        index += 1;
        break;
      case "--max-token-length":
        options.maxTokenLength = Number(requiredValue(rest, index, argument));
        index += 1;
        break;
      case "--model":
        options.model = requiredValue(rest, index, argument);
        index += 1;
        break;
      case "--no-launch":
        options.noLaunch = true;
        break;
      case "--model-command":
        options.modelCommand = requiredValue(rest, index, argument);
        index += 1;
        break;
      case "--model-arg":
        options.modelArgs.push(requiredValue(rest, index, argument));
        index += 1;
        break;
      case "--date":
        options.date = requiredValue(rest, index, argument);
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--force":
        options.force = true;
        break;
      default:
        if (command === "fork" && !argument.startsWith("--") && !options.session) options.session = argument;
        else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.session) throw new Error(command === "fork" ? "fork requires an exact source Session path or ID" : "--session is required");
  if (options.maxTokenLength !== undefined && (!Number.isSafeInteger(options.maxTokenLength) || options.maxTokenLength < 1)) throw new Error("--max-token-length must be a positive integer");
  if (!options.json && command !== "fork") throw new Error("--json is required");
  if (options.force && command !== "summarize")
    throw new Error("--force only applies to summarize");
  return options;
}

export function runModelCommand(
  command,
  args,
  prompt,
  { spawnProcess = spawn, env } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      reject(
        new Error(`Cannot start model command ${command}: ${error.message}`),
      ),
    );
    child.on("close", (code, signal) => {
      if (code === 0) return resolve(stdout);
      const detail =
        stderr.trim() ||
        `exit ${code ?? "null"}${signal ? ` (${signal})` : ""}`;
      reject(new Error(`Model command failed: ${detail}`));
    });
    child.stdin.end(prompt);
  });
}

/**
 * The normal CLI adapter deliberately invokes Pi in a stripped, ephemeral
 * print mode. Pi—not this package—continues to own credentials, provider
 * configuration, proxy behavior, and model transport.
 */
export function runPiRarebitModel({
  model,
  prompt,
  agentDir,
  piCommand = "pi",
  spawnProcess = spawn,
}) {
  const args = [
    "--print",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--model",
    `${model.provider}/${model.id}`,
    "--system-prompt",
    "Return only the requested result. Do not use tools.",
  ];
  return runModelCommand(piCommand, args, prompt, {
    spawnProcess,
    env: {
      ...process.env,
      ...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}),
    },
  });
}

function configuredAgentDir(env = process.env) {
  return env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

async function jsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Cannot read Pi settings ${path}: ${error.message}`);
  }
}

/** Read the narrow, explicit model/policy contract shared with the Pi shell. */
export async function readRarebitCliSettings({
  agentDir = configuredAgentDir(),
  cwd = process.cwd(),
} = {}) {
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  const resolved = resolveRarebitSettings(
    await jsonFile(globalPath),
    await jsonFile(projectPath),
  );
  if (!resolved.model)
    throw new Error(
      resolved.modelConfigurationError ??
        "Rarebit model is not configured; set rarebit.model to provider/model in Pi settings",
    );
  return {
    agentDir,
    model: resolved.model,
    modelProvenance: {
      source: "pi_settings_files",
      settingsKey: "rarebit.model",
      status: "resolved",
      rawRefs: [globalPath, projectPath],
    },
    summaryPolicy: resolved.summaryPolicy,
    autoTitle: resolved.autoTitle,
  };
}

function contextForLoadedSession(loaded) {
  return {
    sessionManager: {
      getHeader: () => ({ id: loaded.session.id }),
      getSessionFile: () => loaded.sessionFile,
      getBranch: () => loaded.branch,
    },
  };
}

function sessionDate(session, explicitDate) {
  if (explicitDate) return explicitDate;
  const timestamp = session?.startedAt;
  if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}/.test(timestamp))
    return timestamp.slice(0, 10);
  throw new Error(
    "--date YYYY-MM-DD is required because the persisted Session has no ISO start date",
  );
}

async function modelRuntime(options, dependencies) {
  if (options.modelCommand) {
    return {
      model: { provider: "external-command", id: options.modelCommand },
      modelProvenance: { source: "explicit_model_command", status: "resolved" },
      summaryPolicy: {},
      complete: (prompt) =>
        dependencies.runModelCommand(
          options.modelCommand,
          options.modelArgs,
          prompt,
        ),
    };
  }
  const settings = await dependencies.readSettings();
  return {
    ...settings,
    complete: (prompt) =>
      dependencies.runPiModel({
        model: settings.model,
        prompt,
        agentDir: settings.agentDir,
      }),
  };
}

async function resolveForkTarget({ cwd, explicitModel, agentDir, resolveTarget }) {
  if (resolveTarget) return resolveTarget({ cwd, explicitModel, agentDir });
  const {
    ModelRuntime,
    SessionManager,
    SettingsManager,
    createAgentSession,
  } = await import("@earendil-works/pi-coding-agent");
  const settings = SettingsManager.create(cwd, agentDir);
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  let targetModel;
  if (explicitModel) {
    const [provider, ...idParts] = explicitModel.split("/");
    const id = idParts.join("/");
    targetModel = runtime.getModel(provider, id);
  } else {
    const provider = settings.getDefaultProvider();
    const id = settings.getDefaultModel();
    targetModel = provider && id ? runtime.getModel(provider, id) : undefined;
    if (!targetModel) targetModel = (await runtime.getAvailable())[0];
  }
  if (!targetModel?.provider || !targetModel?.id || !Number.isFinite(targetModel.contextWindow))
    throw new Error("Cannot resolve the target Pi model and context window before forking; set Pi's default model or pass --model provider/model");
  const global = settings.getGlobalSettings();
  const project = settings.getProjectSettings();
  const key = `${targetModel.provider}/${targetModel.id}`;
  const overrides = { ...(global.compaction?.modelOverrides ?? {}), ...(project.compaction?.modelOverrides ?? {}) };
  const reserveTokens = overrides[key]?.reserveTokens ?? settings.getCompactionReserveTokens();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: targetModel,
    modelRuntime: runtime,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(cwd),
  });
  try {
    const promptOverheadTokens = Math.ceil(String(session.agent.state.systemPrompt ?? "").length / 4);
    const toolOverheadTokens = Math.ceil(JSON.stringify(session.agent.state.tools ?? []).length / 4);
    return { model: targetModel, reserveTokens, promptOverheadTokens, toolOverheadTokens };
  } finally {
    session.dispose();
  }
}

export async function runPiFork({ session, maxTokenLength, cwd = process.cwd(), piCommand = "pi", noLaunch = false, model, agentDir, resolveTarget, spawnProcess = spawn } = {}) {
  const loaded = await readRarebitSession(session);
  const target = await resolveForkTarget({ cwd, explicitModel: model, agentDir, resolveTarget });
  const targetModel = target.model;
  const plan = buildRarebitForkPlan({
    header: loaded.parsed.header,
    sessionFile: loaded.sessionFile,
    cwd,
    branch: loaded.branch,
    targetCwd: cwd,
    maxTokenLength,
    targetModel,
    reserveTokens: target.reserveTokens,
    promptOverheadTokens: target.promptOverheadTokens,
    toolOverheadTokens: target.toolOverheadTokens,
  });
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const destinationManager = SessionManager.create(cwd);
  const destination = sessionFilenameFor({ sessionDir: destinationManager.getSessionDir(), forkCreatedAt: plan.forkCreatedAt, sessionId: destinationManager.getSessionId() });
  const built = createRarebitForkEntries(plan, { sessionId: destinationManager.getSessionId() });
  await writeRarebitForkFile(destination, built);
  const result = { operation: "fork", session: destination, sourceSessionId: loaded.session.id, ...plan.omission, headroom: plan.headroom, launched: false };
  if (noLaunch) return result;
  const child = spawnProcess(piCommand, ["--session", destination], { cwd, stdio: "inherit", shell: false, env: process.env });
  const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal })); });
  return { ...result, launched: true, exitCode: exit.code, signal: exit.signal };
}

export async function runRarebitCli(options, dependencies = {}) {
  const runtimeDependencies = {
    readSettings: dependencies.readSettings ?? readRarebitCliSettings,
    runPiModel: dependencies.runPiModel ?? runPiRarebitModel,
    runModelCommand: dependencies.runModelCommand ?? runModelCommand,
    processSummary: dependencies.processSummary ?? processRarebitSummary,
    processTitle: dependencies.processTitle ?? processRarebitTitle,
  };
  if (options.command === "query") return queryRarebits(options.session);
  if (options.command === "extract") return extractRarebits(options.session);
  if (options.command === "fork") {
    return runPiFork({ session: options.session, maxTokenLength: options.maxTokenLength, noLaunch: options.noLaunch, piCommand: dependencies.piCommand, model: options.model, agentDir: dependencies.agentDir, resolveTarget: dependencies.resolveTarget, spawnProcess: dependencies.spawnProcess });
  }

  const loaded = await readRarebitSession(options.session);
  const runtime = await modelRuntime(options, runtimeDependencies);
  if (options.command === "summarize") {
    const result = await runtimeDependencies.processSummary(
      contextForLoadedSession(loaded),
      {
        model: runtime.model,
        modelProvenance: runtime.modelProvenance,
        summaryPolicy: runtime.summaryPolicy,
        forceSynthesis: options.force === true,
        allowExternalSession: true,
        rarebitRoot: dependencies.rarebitRoot,
        sessionRoot: dependencies.sessionRoot,
        modelClient: {
          complete: async ({ prompt }) => ({
            text: await runtime.complete(prompt),
          }),
        },
      },
    );
    return {
      operation: "summary",
      status: result.record.status,
      duplicate: result.duplicate === true,
      inFlight: result.inFlight === true,
      record: result.record,
    };
  }

  const result = await runtimeDependencies.processTitle(
    contextForLoadedSession(loaded),
    {
      model: runtime.model,
      modelProvenance: runtime.modelProvenance,
      allowFirstUserFallback: true,
      evidenceProvenance: "branch_user_fallback",
      titleDate: sessionDate(loaded.session, options.date),
      allowExternalSession: true,
      rarebitRoot: dependencies.rarebitRoot,
      sessionRoot: dependencies.sessionRoot,
      modelClient: {
        complete: async ({ prompt }) => ({
          text: await runtime.complete(prompt),
        }),
      },
    },
  );
  return {
    operation: "title",
    status: result.record.status,
    duplicate: result.duplicate === true,
    inFlight: result.inFlight === true,
    session: loaded.session,
    title: result.record.title,
    record: result.record,
  };
}
