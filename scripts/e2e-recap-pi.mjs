#!/usr/bin/env node

/**
 * Real Pi TUI coverage for the Rarebit recap projection.
 *
 * The fixture provider runs on loopback and never uses a credential. Pi runs
 * in a private tmux server with a disposable agent directory, project, and
 * Session directory. The test intentionally leaves recap.delay_ms unset so
 * the one-minute default is exercised.
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
const piEntry = fileURLToPath(
  await import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const piRoot = resolve(dirname(dirname(piEntry)));
const piCli = join(piRoot, "dist/cli.js");
const tmux = process.env.TMUX_BIN ?? "tmux";

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function capturePane(socket, session) {
  try {
    const { stdout } = await execFile(tmux, [
      "-L",
      socket,
      "capture-pane",
      "-p",
      "-J",
      "-t",
      session,
      "-S",
      "-200",
    ]);
    return stdout;
  } catch {
    return "";
  }
}

async function sendKeys(socket, session, text) {
  await execFile(tmux, ["-L", socket, "send-keys", "-l", "-t", session, text]);
}

async function press(socket, session, key) {
  await execFile(tmux, ["-L", socket, "send-keys", "-t", session, key]);
}

async function waitFor(label, predicate, timeout = 5_000, interval = 100) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${lastValue ? ` (${lastValue})` : ""}`);
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else files.push(path);
  }
  return files;
}

const temp = await mkdtemp(join(tmpdir(), "rarebit-recap-pi-e2e-"));
const agentDir = join(temp, "agent");
const projectDir = join(temp, "project");
const sessionDir = join(temp, "sessions");
const rarebitRoot = join(temp, "receipts");
const fixtureExtension = join(temp, "rarebit-fixture-extension.mjs");
const requestLog = join(temp, "provider-requests.jsonl");
const socket = `rarebit-recap-${process.pid}`;
const session = "rarebit-recap-e2e";
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
    const payload = JSON.parse(body);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    // The normal Pi system prompt contains the word "summary". Classify only
    // user content so an owner prompt cannot be mistaken for the detached
    // Rarebit model request.
    const userText = messages
      .filter((message) => message?.role === "user")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? ""),
      )
      .join("\n");
    const isSummary = /rarebit|materializ|all_requests_accomplished/i.test(
      userText,
    );
    const interactiveNumber =
      requests.filter((entry) => entry.kind === "interactive").length + 1;
    const text = isSummary
      ? JSON.stringify({
          summary: "RECAP_SENTINEL: display-only current Summary",
          sessionStatus: "finished",
          statusReason: "all_requests_accomplished",
        })
      : `INTERACTIVE_${interactiveNumber}_DONE`;
    const entry = {
      kind: isSummary ? "summary" : "interactive",
      body: payload,
      text,
      requestAt: Date.now(),
    };
    entry.responseAt = Date.now();
    requests.push(entry);
    await writeFile(
      requestLog,
      `${JSON.stringify(entry)}\n`,
      { flag: "a", mode: 0o600 },
    );

    const first = JSON.stringify({
      id: `rarebit-e2e-${requests.length}`,
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: text },
          finish_reason: null,
        },
      ],
    });
    const finish = JSON.stringify({
      id: `rarebit-e2e-${requests.length}`,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(`data: ${first}\n\n`);
    response.write(`data: ${finish}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolvePromise, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = provider.address().port;

  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          local: {
            baseUrl: `http://127.0.0.1:${port}/v1`,
            api: "openai-completions",
            apiKey: "fixture",
            models: [
              {
                id: "fixture",
                name: "Rarebit recap fixture",
                reasoning: false,
                input: ["text"],
                contextWindow: 100_000,
                maxTokens: 512,
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify(
      {
        rarebit: {
          model: "local/fixture",
          auto_title: false,
          min_total_length: 0,
          max_rarebit_ratio: 1,
          recap: {
            timezone: "Asia/Hong_Kong",
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  // Keep the project settings file present to exercise Pi's trusted-project
  // settings loader. It does not override recap.delay_ms, so 60 seconds is
  // the effective default under test.
  await writeFile(join(projectDir, ".pi", "settings.json"), "{}\n", {
    mode: 0o600,
  });

  // The fixture adapter keeps the real settings loader and model registry, but
  // gives Rarebit private roots that match the disposable Pi Session.
  await writeFile(
    fixtureExtension,
    `import registerPiRarebit from ${JSON.stringify(
      pathToFileURL(join(packageRoot, "src/extension.mjs")).href,
    )};\n\nexport default function registerFixtureRarebit(pi) {\n  return registerPiRarebit(pi, {\n    sessionRoot: ${JSON.stringify(sessionDir)},\n    rarebitRoot: ${JSON.stringify(rarebitRoot)},\n  });\n}\n`,
    { mode: 0o600 },
  );
  const childEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
  const command = [
    "env",
    `PI_CODING_AGENT_DIR=${agentDir}`,
    "PI_OFFLINE=1",
    "PI_TELEMETRY=0",
    process.execPath,
    piCli,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--approve",
    "--extension",
    fixtureExtension,
    "--session-dir",
    sessionDir,
    "--model",
    "local/fixture",
    "--tui-mode",
    "regular",
  ];
  const tmuxProcess = spawn(
    tmux,
    ["-L", socket, "new-session", "-d", "-x", "140", "-y", "48", "-s", session, ...command],
    { cwd: projectDir, env: childEnv, stdio: "ignore" },
  );
  await new Promise((resolvePromise, reject) => {
    tmuxProcess.once("error", reject);
    tmuxProcess.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`tmux new-session exited ${code}`)),
    );
  });
  tmuxStarted = true;
  await waitFor(
    "Pi editor",
    // Pi 0.84.2 leaves the empty editor line blank in regular mode. The
    // footer's token counter is the stable rendered readiness marker.
    async () => (await capturePane(socket, session)).includes("0.0%/100k"),
    10_000,
  );
  // The footer paints before the extension/resource startup queue finishes.
  // Give Pi one event-loop turn before injecting the first owner prompt.
  await sleep(750);

  await sendKeys(socket, session, "first recap turn");
  await press(socket, session, "Enter");
  await waitFor(
    "first provider response",
    async () => (await capturePane(socket, session)).includes("INTERACTIVE_1_DONE"),
    15_000,
  );
  const requestCountAtWidget = () => requests.length;
  await waitFor(
    "display-only recap widget after default 60 seconds",
    async () => (await capturePane(socket, session)).includes("RECAP_SENTINEL"),
    75_000,
  );
  const widgetRenderedAt = Date.now();
  const widgetPane = await capturePane(socket, session);
  assert.match(widgetPane, /RECAP_SENTINEL/);
  assert.match(widgetPane, /Recap/);
  assert.match(widgetPane, /Asia\/Hong_Kong/);
  const summaryRequestsAtWidget = requests.filter(
    (entry) => entry.kind === "summary",
  );
  assert.ok(summaryRequestsAtWidget.length > 0, "summary provider request was recorded");
  const latestSummaryResponse = summaryRequestsAtWidget.at(-1).responseAt;
  assert.ok(
    widgetRenderedAt - latestSummaryResponse >= 59_750,
    `recap rendered before its 60s default (${widgetRenderedAt - latestSummaryResponse}ms)`,
  );
  const providerRequestCountBeforeTyping = requestCountAtWidget();

  // Keystrokes do not emit a Rarebit lifecycle event. The human can keep
  // editing while the display-only widget remains above the editor.
  await sendKeys(socket, session, "typed while recap is visible");
  const typingPane = await waitFor(
    "typed editor text while recap remains",
    async () => {
      const pane = await capturePane(socket, session);
      return pane.includes("typed while recap is visible") ? pane : false;
    },
    5_000,
  );
  assert.match(typingPane, /RECAP_SENTINEL/);
  assert.equal(
    requestCountAtWidget(),
    providerRequestCountBeforeTyping,
    "displaying recap must not trigger another provider request",
  );
  assert.equal(
    requests.filter((entry) => entry.kind === "summary").length,
    summaryRequestsAtWidget.length,
    "typing/display must not trigger another Summary",
  );

  // Submitted input clears the widget before the next provider request.
  await press(socket, session, "Enter");
  await waitFor(
    "second provider request",
    async () => {
      const entries = JSON.parse(`[${(await readFile(requestLog, "utf8")).trim().replace(/\n/g, ",")}]`);
      return entries.filter((entry) => entry.kind === "interactive").length >= 2;
    },
    15_000,
  );
  const afterSubmitPane = await waitFor(
    "recap clear after submitted input",
    async () => {
      const pane = await capturePane(socket, session);
      return !pane.includes("RECAP_SENTINEL") ? pane : false;
    },
    5_000,
  );
  assert.doesNotMatch(afterSubmitPane, /RECAP_SENTINEL/);

  const loggedRequests = (await readFile(requestLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(loggedRequests.some((entry) => entry.kind === "summary"));
  const secondInteractive = loggedRequests.filter(
    (entry) => entry.kind === "interactive",
  )[1];
  assert.ok(secondInteractive, "the submitted second turn reached the fixture provider");
  assert.doesNotMatch(
    JSON.stringify(secondInteractive.body),
    /RECAP_SENTINEL/,
    "display-only recap content must not enter the next provider context",
  );

  const sessionFiles = (await walkFiles(sessionDir)).filter((path) =>
    path.endsWith(".jsonl"),
  );
  const sessionText = (
    await Promise.all(sessionFiles.map((path) => readFile(path, "utf8")))
  ).join("\n");
  assert.doesNotMatch(sessionText, /RECAP_SENTINEL/);
  const receiptFiles = await walkFiles(rarebitRoot);
  assert.ok(receiptFiles.length > 0, "the real Rarebit sidecar was written");

  const evidence = {
    providerRequests: loggedRequests,
    summaryResponseAt: latestSummaryResponse,
    widgetRenderedAt,
    elapsedFromLatestSummaryMs: widgetRenderedAt - latestSummaryResponse,
    widgetPane,
    typingPane,
    afterSubmitPane,
    sessionFiles,
    receiptFiles,
  };
  if (keepTemp) {
    await writeFile(join(temp, "pane-widget.txt"), widgetPane, { mode: 0o600 });
    await writeFile(join(temp, "pane-typing.txt"), typingPane, { mode: 0o600 });
    await writeFile(join(temp, "pane-after-submit.txt"), afterSubmitPane, {
      mode: 0o600,
    });
    await writeFile(join(temp, "evidence.json"), JSON.stringify(evidence, null, 2), {
      mode: 0o600,
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      pi: JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")).version,
      defaultDelayMs: 60_000,
      providerRequests: loggedRequests.length,
      summaryRequests: loggedRequests.filter((entry) => entry.kind === "summary").length,
      elapsedFromLatestSummaryMs: evidence.elapsedFromLatestSummaryMs,
      evidenceRoot: keepTemp ? temp : null,
      sessionFiles: sessionFiles.map((path) => basename(path)),
      receiptFiles: receiptFiles.map((path) => path.slice(temp.length + 1)),
      checks: [
        "real Pi TUI rendered recap widget after 60 seconds",
        "typing preserved widget",
        "submitted input cleared widget",
        "next provider request excluded recap sentinel",
        "Session JSONL excluded recap sentinel",
      ],
    }, null, 2),
  );
} catch (error) {
  keepTemp = true;
  const failurePane = tmuxStarted ? await capturePane(socket, session) : "";
  console.error(`Rarebit recap Pi E2E failed: ${error?.stack ?? error}`);
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
  if (provider?.listening)
    await new Promise((resolvePromise) => provider.close(resolvePromise));
  if (keepTemp) {
    const tmuxCleanup = await execFile(tmux, ["-L", socket, "has-session"])
      .then(() => "server_still_running")
      .catch(() => "clean");
    await writeFile(join(temp, "tmux-cleanup.txt"), `${tmuxCleanup}\n`, {
      mode: 0o600,
    });
  }
  if (!keepTemp) await rm(temp, { recursive: true, force: true });
}
