#!/usr/bin/env node

/**
 * Real Pi TUI settings coverage for Rarebit.
 *
 * The run uses a disposable agent directory, trusted project, Session root,
 * and loopback-only model registry. The settings flow must render its tabs,
 * save only the Rarebit namespace, and reopen with the saved value. It must
 * not start a provider request or append a Session record.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piEntry = fileURLToPath(await import.meta.resolve("@earendil-works/pi-coding-agent"));
const piRoot = resolve(dirname(dirname(piEntry)));
const piCli = join(piRoot, "dist/cli.js");
const tmux = process.env.TMUX_BIN ?? "tmux";

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function pane(socket, session) {
  try {
    const { stdout } = await execFile(tmux, ["-L", socket, "capture-pane", "-p", "-J", "-t", session, "-S", "-200"]);
    return stdout;
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
async function submitSlash(socket, session, command) {
  await keys(socket, session, command);
  // Pi's editor keeps slash-command autocomplete active after the literal
  // command text arrives through tmux. Tab accepts the selected command token;
  // Enter then submits the now-complete extension command.
  await sleep(500);
  await press(socket, session, "Tab");
  await sleep(100);
  await press(socket, session, "Enter");
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

const temp = await mkdtemp(join(tmpdir(), "rarebit-settings-pi-e2e-"));
const agentDir = join(temp, "agent");
const projectDir = join(temp, "project");
const sessionDir = join(temp, "sessions");
const rarebitRoot = join(temp, "receipts");
const fixtureExtension = join(temp, "rarebit-fixture-extension.mjs");
const requestLog = join(temp, "provider-requests.jsonl");
const settingsFile = join(agentDir, "settings.json");
const projectSettingsFile = join(projectDir, ".pi", "settings.json");
const socket = `rarebit-settings-${process.pid}`;
const session = "rarebit-settings-e2e";
let provider;
let tmuxStarted = false;
let keepTemp = process.env.RAREBIT_KEEP_E2E_TEMP === "1";

try {
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const requests = [];
  provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const entry = { at: Date.now(), body: JSON.parse(body) };
    requests.push(entry);
    await writeFile(requestLog, `${JSON.stringify(entry)}\n`, { flag: "a", mode: 0o600 });
    const chunk = JSON.stringify({
          id: `rarebit-settings-${requests.length}`,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "SETTINGS_BASELINE_DONE" }, finish_reason: "stop" }],
    });
    response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
    response.end(`data: ${chunk}\n\ndata: [DONE]\n\n`);
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
        models: [{ id: "fixture", name: "settings fixture", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 512 }],
      },
    },
  }, null, 2), { mode: 0o600 });
  await writeFile(settingsFile, JSON.stringify({
    theme: "dark",
    another_extension: { keep: true },
    rarebit: { model: "local/fixture", auto_title: false },
  }, null, 2), { mode: 0o600 });
  await writeFile(projectSettingsFile, "{}\n", { mode: 0o600 });
  await writeFile(fixtureExtension, `import registerPiRarebit from ${JSON.stringify(pathToFileURL(join(packageRoot, "src/extension.mjs")).href)};
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

  // Establish a persisted Session before measuring settings side effects.
  // Keep this baseline request separate from the settings no-model-call check.
  await keys(socket, session, "settings baseline");
  await press(socket, session, "Enter");
  await waitFor("baseline provider response", async () => (await pane(socket, session)).includes("SETTINGS_BASELINE_DONE"), 15_000);
  const providerRequestsBeforeSettings = requests.length;
  const sessionSnapshot = async () => Object.fromEntries(await Promise.all(
    (await walk(sessionDir)).filter((file) => file.endsWith(".jsonl")).sort()
      .map(async (file) => [file, await readFile(file, "utf8")]),
  ));
  await waitFor("persisted baseline assistant", async () =>
    Object.values(await sessionSnapshot()).some((text) => text.includes("SETTINGS_BASELINE_DONE")));
  const sessionsBeforeSettings = await sessionSnapshot();

  await submitSlash(socket, session, "/rarebit");
  const palettePane = await waitFor("Rarebit parent palette", async () => {
    const output = await pane(socket, session);
    return output.includes("Human-only command palette") && output.includes("Command help") ? output : false;
  });
  await press(socket, session, "Escape");
  await waitFor("editor after palette close", async () => !(await pane(socket, session)).includes("Human-only command palette"));
  await sleep(200);

  // Open the real command and settings surface.
  await submitSlash(socket, session, "/rarebit settings");
  const initialPane = await waitFor("settings tabs", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit Settings") && output.includes("Actions") && output.includes("Summary") && output.includes("Recap") && output.includes("Session") ? output : false;
  });
  assert.match(initialPane, /Show Summary triggered/);
  assert.match(initialPane, /Actions\s+\/\s+Summary\s+\/\s+Recap\s+\/\s+Session/);

  // The editor opens on Summary. Visit Recap in the rendered TUI so the
  // timezone and delay fields are covered, then cycle back to Summary.
  await press(socket, session, "Tab");
  const recapPane = await waitFor("Recap settings tab", async () => {
    const output = await pane(socket, session);
    return output.includes("Recap timezone") && output.includes("Recap delay (ms)") ? output : false;
  });
  assert.match(recapPane, /Recap timezone/);
  assert.match(recapPane, /60,000/);
  await press(socket, session, "Tab");
  await sleep(100);
  await press(socket, session, "Tab");
  await sleep(100);
  await press(socket, session, "Tab");
  await sleep(100);
  await waitFor("Summary tab after Recap", async () => (await pane(socket, session)).includes("Show Summary triggered"));

  // Summary is the initial tab. Choose its first row, set `on`, and confirm.
  await press(socket, session, "Enter");
  await waitFor("diagnostic choices", async () => {
    const output = await pane(socket, session);
    return output.includes("Show Summary triggered") && output.includes("Remove override") ? output : false;
  });
  await press(socket, session, "Down");
  await sleep(100);
  await press(socket, session, "Down");
  await sleep(100);
  await press(socket, session, "Enter");
  await waitFor("save confirmation", async () => (await pane(socket, session)).includes("Save Rarebit global settings?"));
  await press(socket, session, "Enter");
  await waitFor("saved settings notice", async () => (await pane(socket, session)).includes("Saved Rarebit global settings."));
  await press(socket, session, "Escape");
  await waitFor("editor after settings close", async () => !(await pane(socket, session)).includes("Rarebit Settings"));

  const saved = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(saved.theme, "dark");
  assert.deepEqual(saved.another_extension, { keep: true });
  assert.equal(saved.rarebit.diagnostics.summary_triggered, true);
  assert.equal(requests.length, providerRequestsBeforeSettings, "settings must not call a model provider");

  // Reopen in the same real TUI and verify the persisted field is visible.
  await submitSlash(socket, session, "/rarebit settings");
  const reopenedPane = await waitFor("reopened settings", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit Settings") && output.includes("Show Summary triggered: on") ? output : false;
  });
  assert.match(reopenedPane, /Show Summary triggered: on/);
  await press(socket, session, "Escape");
  await press(socket, session, "Escape");
  await sleep(250);
  const sessionText = (await Promise.all((await walk(sessionDir)).filter((file) => file.endsWith(".jsonl")).map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(sessionText, /Saved Rarebit|Summary triggered/);
  assert.deepEqual(await sessionSnapshot(), sessionsBeforeSettings, "palette and settings must not append or change Session records");
  assert.equal(requests.length, providerRequestsBeforeSettings, "reopening settings must not call a model provider");

  const evidence = { palettePane, initialPane, recapPane, reopenedPane, requests, settings: saved };
  if (keepTemp) await writeFile(join(temp, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    pi: JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")).version,
    providerRequests: requests.length,
    settingsFile,
    checks: ["real Pi TUI rendered Actions/Summary/Recap/Session tabs", "confirmed edit persisted", "reopen showed saved value", "other settings namespaces preserved", "settings made no provider request or Session write"],
    evidenceRoot: keepTemp ? temp : null,
  }, null, 2));
} catch (error) {
  keepTemp = true;
  const failurePane = tmuxStarted ? await pane(socket, session) : "";
  console.error(`Rarebit settings Pi E2E failed: ${error?.stack ?? error}`);
  if (failurePane) console.error(`Pi pane at failure:\n${failurePane}`);
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
  if (keepTemp) {
    const cleanup = await execFile(tmux, ["-L", socket, "has-session"]).then(() => "server_still_running").catch(() => "clean");
    await writeFile(join(temp, "tmux-cleanup.txt"), `${cleanup}\n`, { mode: 0o600 });
  } else await rm(temp, { recursive: true, force: true });
}
