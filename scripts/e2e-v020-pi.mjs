#!/usr/bin/env node

/**
 * Packed-artifact Pi 0.84.2 verification for the v0.2 Summary/Recap surface.
 *
 * Set RAREBIT_PACKAGE_TGZ to a tarball produced by `npm pack` to exercise the
 * installed artifact. Without it, the fixture imports this checkout's source.
 * The provider is loopback-only and the Pi agent/project/Session roots are
 * disposable.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piEntry = fileURLToPath(await import.meta.resolve("@earendil-works/pi-coding-agent"));
const piRoot = resolve(dirname(dirname(piEntry)));
const piCli = join(piRoot, "dist/cli.js");
const resolveTuiRoot = (fromRoot) => {
  const entry = createRequire(join(fromRoot, "package.json")).resolve("@earendil-works/pi-tui");
  return resolve(dirname(entry), "..");
};
const sourceTuiRoot = process.env.RAREBIT_PI_TUI_ROOT ?? resolveTuiRoot(packageRoot);
const tmux = process.env.TMUX_BIN ?? "tmux";
const keepTemp = process.env.RAREBIT_KEEP_E2E_TEMP === "1";
const packageTarball = process.env.RAREBIT_PACKAGE_TGZ;

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function pane(socket, session, ansi = false) {
  try {
    const args = ["-L", socket, "capture-pane", "-p", "-J"];
    if (ansi) args.push("-e");
    args.push("-t", session, "-S", "-240");
    return (await execFile(tmux, args)).stdout;
  } catch {
    return "";
  }
}

async function keys(socket, session, text) {
  await execFile(tmux, ["-L", socket, "send-keys", "-l", "-t", session, text]);
}

async function press(socket, session, key) {
  await execFile(tmux, ["-L", socket, "send-keys", "-t", session, key]);
}

async function waitFor(label, predicate, timeout = 10_000, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else files.push(file);
  }
  return files;
}

const temp = await mkdtemp(join(tmpdir(), "rarebit-v020-pi-e2e-"));
const agentDir = join(temp, "agent");
const projectDir = join(temp, "project");
const sessionDir = join(temp, "sessions");
const rarebitRoot = join(temp, "receipts");
const fixtureExtension = join(temp, "rarebit-fixture-extension.mjs");
const requestLog = join(temp, "provider-requests.jsonl");
const installedRoot = join(temp, "installed");
const socket = `rarebit-v020-${process.pid}`;
const session = "rarebit-v020-e2e";
let provider;
let tmuxStarted = false;

try {
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const installedPackageRoot = packageTarball
    ? join(installedRoot, "package")
    : packageRoot;
  if (packageTarball) {
    await mkdir(installedRoot, { recursive: true });
    await execFile("tar", ["-xzf", resolve(packageTarball), "-C", installedRoot]);
    await mkdir(join(installedRoot, "node_modules", "@earendil-works"), { recursive: true });
    await execFile("ln", ["-s", sourceTuiRoot, join(installedRoot, "node_modules/@earendil-works/pi-tui")]);
    await execFile("ln", ["-s", piRoot, join(installedRoot, "node_modules/@earendil-works/pi-coding-agent")]);
  }

  const requests = [];
  provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const userText = messages
      .filter((message) => message?.role === "user")
      .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""))
      .join("\n");
    const isSummary = /You are the HyperCarrier Rarebit summarizer/i.test(userText);
    const interactiveNumber = requests.filter((entry) => entry.kind === "interactive").length + 1;
    const fullSummary = Array.from({ length: 24 }, (_, index) => `line-${index + 1} FULL_RECAP_TAIL_${index + 1}`).join("\n");
    const text = isSummary
      ? JSON.stringify({ summary: fullSummary, sessionStatus: "finished", statusReason: "all_requests_accomplished" })
      : `INTERACTIVE_${interactiveNumber}_DONE`;
    const entry = { kind: isSummary ? "summary" : "interactive", body: payload, text, requestAt: Date.now(), responseAt: Date.now() };
    requests.push(entry);
    await writeFile(requestLog, `${JSON.stringify(entry)}\n`, { flag: "a", mode: 0o600 });
    const id = `rarebit-v020-${requests.length}`;
    const first = JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] });
    const finish = JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    response.write(`data: ${first}\n\n`);
    response.write(`data: ${finish}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolvePromise, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = provider.address().port;

  await writeFile(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      local: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: "openai-completions",
        apiKey: "fixture",
        models: [{ id: "fixture", name: "v0.2 fixture", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 512 }],
      },
    },
  }, null, 2), { mode: 0o600 });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    theme: "dark",
    other_extension: { preserve: true },
    rarebit: {
      model: "local/fixture",
      auto_title: false,
      min_total_length: 0,
      max_rarebit_ratio: 1,
      summary_prompt: "Use short factual bullets and state uncertainty.",
      recap: { timezone: "Asia/Hong_Kong" },
    },
  }, null, 2), { mode: 0o600 });
  await writeFile(join(projectDir, ".pi", "settings.json"), "{}\n", { mode: 0o600 });

  await writeFile(fixtureExtension, `import registerPiRarebit from ${JSON.stringify(pathToFileURL(join(installedPackageRoot, "src/extension.mjs")).href)};
export default function registerFixtureRarebit(pi) {
  return registerPiRarebit(pi, { sessionRoot: ${JSON.stringify(sessionDir)}, rarebitRoot: ${JSON.stringify(rarebitRoot)} });
}
`, { mode: 0o600 });

  const childEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0" };
  const command = [
    "env", `PI_CODING_AGENT_DIR=${agentDir}`, "PI_OFFLINE=1", "PI_TELEMETRY=0",
    process.execPath, piCli, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--approve",
    "--extension", fixtureExtension, "--session-dir", sessionDir, "--model", "local/fixture", "--tui-mode", "regular",
  ];
  const child = spawn(tmux, ["-L", socket, "new-session", "-d", "-x", "140", "-y", "48", "-s", session, ...command], { cwd: projectDir, env: childEnv, stdio: "ignore" });
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`tmux exited ${code}`)));
  });
  tmuxStarted = true;
  await waitFor("Pi editor", async () => (await pane(socket, session)).includes("0.0%/100k"));
  await sleep(750);

  await keys(socket, session, "first v020 recap turn");
  await press(socket, session, "Enter");
  await waitFor("interactive response", async () => (await pane(socket, session)).includes("INTERACTIVE_1_DONE"), 15_000);
  const summaryResponse = await waitFor("custom Summary request", async () => {
    const summary = requests.find((entry) => entry.kind === "summary");
    return summary?.body?.messages?.some((message) => {
      if (message?.role !== "user") return false;
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
      return content.includes("Use short factual bullets");
    }) ? summary : false;
  }, 15_000);
  assert.ok(summaryResponse, "configured summary_prompt reached the provider");
  const summaryAt = summaryResponse.responseAt;

  const widgetPane = await waitFor("full Recap widget", async () => {
    const output = await pane(socket, session);
    return output.includes("FULL_RECAP_TAIL_24") ? output : false;
  }, 75_000);
  const widgetAnsi = await pane(socket, session, true);
  assert.match(widgetPane, /Recap/);
  assert.match(widgetPane, /FULL_RECAP_TAIL_1/);
  assert.match(widgetPane, /FULL_RECAP_TAIL_24/);
  assert.doesNotMatch(widgetPane, /recap expand/i);
  assert.match(widgetAnsi, /\x1b\[[0-9;]*m/);
  assert.match(widgetAnsi, /Recap/);
  assert.match(widgetAnsi, /\x1b\[38;5;241m[^\n]*Recap/, "Recap header uses the muted foreground");
  assert.match(widgetAnsi, /\x1b\[38;5;244m[^\n]*FULL_RECAP_TAIL_1/, "Recap body uses the faded foreground");
  assert.ok(Date.now() - summaryAt >= 59_750, "Recap rendered before the one-minute default");

  const requestCountAtWidget = requests.length;
  await keys(socket, session, "typed while v020 Recap is visible");
  const typingPane = await waitFor("typing preservation", async () => {
    const output = await pane(socket, session);
    return output.includes("typed while v020 Recap is visible") ? output : false;
  });
  assert.match(typingPane, /FULL_RECAP_TAIL_24/);
  assert.equal(requests.length, requestCountAtWidget);

  await press(socket, session, "Enter");
  await waitFor("second provider request", async () => requests.filter((entry) => entry.kind === "interactive").length >= 2, 15_000);
  const afterSubmit = await waitFor("Recap clear after submit", async () => {
    const output = await pane(socket, session);
    return !output.includes("FULL_RECAP_TAIL_24") ? output : false;
  }, 5_000);
  assert.doesNotMatch(afterSubmit, /FULL_RECAP_TAIL_24/);

  const secondInteractive = requests.filter((entry) => entry.kind === "interactive")[1];
  assert.doesNotMatch(JSON.stringify(secondInteractive.body), /FULL_RECAP_TAIL/);
  const sessionFiles = (await walk(sessionDir)).filter((file) => file.endsWith(".jsonl"));
  const sessionText = (await Promise.all(sessionFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(sessionText, /FULL_RECAP_TAIL/);
  const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.other_extension, { preserve: true });
  assert.equal(settings.rarebit.summary_prompt, "Use short factual bullets and state uncertainty.");

  const evidence = { widgetPane, widgetAnsi, typingPane, afterSubmit, requests, sessionFiles, packageTarball: packageTarball ?? "source" };
  const artifactLabel = packageTarball ? "packed artifact loaded by real Pi" : "source checkout loaded by real Pi";
  if (keepTemp) await writeFile(join(temp, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    artifact: packageTarball ?? "source",
    pi: JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")).version,
    defaultDelayMs: 60_000,
    elapsedFromSummaryMs: Date.now() - summaryAt,
    providerRequests: requests.length,
    evidenceRoot: keepTemp ? temp : null,
    checks: [artifactLabel, "custom summary_prompt reached provider", "full multiline Recap tail rendered", "ANSI themed widget rendered", "typing preserved Recap", "submit cleared Recap", "display content excluded from next provider and Session"],
  }, null, 2));
} catch (error) {
  console.error(`Rarebit v0.2 Pi E2E failed: ${error?.stack ?? error}`);
  console.error(`Temporary evidence retained at ${temp}`);
  throw error;
} finally {
  if (tmuxStarted) {
    await press(socket, session, "C-c").catch(() => {});
    await sleep(100);
    await press(socket, session, "C-c").catch(() => {});
    await execFile(tmux, ["-L", socket, "kill-server"]).catch(() => {});
  }
  if (provider?.listening) await new Promise((resolvePromise) => provider.close(resolvePromise));
  if (!keepTemp) await rm(temp, { recursive: true, force: true });
}
