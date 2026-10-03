#!/usr/bin/env node

/**
 * Real Pi TUI acceptance harness for the Rarebit view feature.
 *
 * Run from any directory with `node packages/hc-rarebit/scripts/e2e-view-pi.mjs`
 * (or `node scripts/e2e-view-pi.mjs` from this package). The local Pi peer is
 * the default. Set RAREBIT_PI_ROOT to another Pi package root; set
 * RAREBIT_TUI_MODE=fullscreen to cover Pi 1.0 mouse-wheel routing. It starts
 * Pi in a unique detached tmux server, loads only this package's extension, and uses
 * a fully mocked Session. It sends no model prompts and never reads user
 * Sessions. Pi runs against disposable agent state and the script kills its
 * tmux server and removes its temporary files on exit.
 *
 * Assertions: context filters tool/thinking rows and older Rarebits, keeps
 * selected prose and Recaps, and resets across reload/session changes. All reads
 * across compactions, both Kitty Ctrl+Super byte sequences toggle/cycle views,
 * search wrap, status, footer, resize, peek input, layering, and cleanup are
 * checked against real Pi without model prompts.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { selectRarebits } from "../src/rarebit-core.mjs";
import { latestRecap } from "../src/rarebit-read-checkpoint.mjs";

const execFile = promisify(execFileCallback);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piEntry = fileURLToPath(await import.meta.resolve("@earendil-works/pi-coding-agent"));
const piRoot = resolve(process.env.RAREBIT_PI_ROOT ?? dirname(dirname(piEntry)));
const piVersion = JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")).version;
const tuiMode = process.env.RAREBIT_TUI_MODE ?? "regular";
const piCli = join(piRoot, "dist/cli.js");
const tmux = process.env.TMUX_BIN ?? "tmux";
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function pane(socket, session) {
  try {
    return (await execFile(tmux, ["-L", socket, "capture-pane", "-p", "-J", "-t", session, "-S", "-240"])).stdout;
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
async function resizeWindow(socket, session, width, height) {
  await execFile(tmux, ["-L", socket, "resize-window", "-t", session, "-x", String(width), "-y", String(height)]);
}
async function waitFor(label, predicate, timeout = 10_000, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(interval);
  }
  const diagnostic = await pane(socket, session);
  throw new Error(`Timed out waiting for ${label}${diagnostic ? `; last pane:\n${diagnostic}` : ""}`);
}
async function submitSlash(socket, session, command) {
  await keys(socket, session, command);
  // Accept Pi's selected slash-command completion, then submit the command.
  await sleep(500);
  await press(socket, session, "Tab");
  await sleep(100);
  await press(socket, session, "Enter");
}

const temp = await mkdtemp(join(tmpdir(), "rarebit-view-pi-e2e-"));
const agentDir = join(temp, "agent");
const projectDir = join(temp, "project");
const sessionDir = join(temp, "sessions");
const sessionFile = join(sessionDir, "rarebit-view-first.jsonl");
const secondSessionFile = join(sessionDir, "rarebit-view-second.jsonl");
const socket = `rarebit-view-${process.pid}`;
const session = "rarebit-view-e2e";
const fixtureExtension = pathToFileURL(join(packageRoot, "src/extension.mjs")).href;
const defects = [];

function mockSession(cwd) {
  const entries = [];
  let parentId = null;
  let id = 0;
  const tick = (n) => new Date(Date.UTC(2026, 0, 1, 12, n)).toISOString();
  const push = (type, fields = {}) => {
    const entry = { type, id: String(++id).padStart(8, "0"), parentId, timestamp: tick(id), ...fields };
    entries.push(entry);
    parentId = entry.id;
    return entry.id;
  };
  const message = (role, content, stopReason) => push("message", {
    message: {
      role,
      content,
      timestamp: Date.parse(tick(id + 1)),
      ...(stopReason ? { stopReason } : {}),
      ...(role === "assistant" ? { api: "mock", provider: "mock", model: "mock", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}),
    },
  });
  entries.push({ type: "session", version: 3, id: "rarebit-view-session", timestamp: tick(0), cwd });

  message("user", "PRECOMPACTION_RAREBIT: earlier conversation sentinel");
  message("assistant", [{ type: "text", text: "PRECOMPACTION_RAREBIT: earlier assistant sentinel" }], "stop");
  for (let n = 1; n <= 12; n++) {
    message("user", `PRECOMPACTION_HISTORY_${String(n).padStart(2, "0")}: ${Array.from({ length: 5 }, (_, line) => `mock line ${line + 1}`).join("\n")}`);
  }
  const compactionId = push("compaction", {
    summary: "Mock context summary. No private session data.",
    firstKeptEntryId: null,
    tokensBefore: 1000,
  });
  entries.find((entry) => entry.id === compactionId).firstKeptEntryId = message("user", "CURRENT_CONTEXT_USER: request after compaction");
  message("user", "CURRENT_CONTEXT_RAREBIT: keep this conversational sentinel");
  message("assistant", [
    { type: "thinking", thinking: "CURRENT_THINKING_SENTINEL: hidden internal text" },
    { type: "text", text: "CURRENT_CONTEXT_ASSISTANT_RAREBIT: current answer sentinel" },
    { type: "toolCall", id: "mock-call", name: "mock_tool", arguments: {} },
  ], "toolUse");
  message("assistant", [
    { type: "thinking", thinking: "THINKING_BLOCK_SENTINEL: hide this reasoning" },
    { type: "text", text: "Thinking..." },
  ], "stop");
  message("assistant", [{ type: "text", text: "Thinking..." }], "stop");
  push("message", { message: {
    role: "toolResult", toolCallId: "mock-call", toolName: "mock_tool",
    content: [{ type: "text", text: "CURRENT_TOOL_OUTPUT_SENTINEL: hidden tool output" }],
    isError: false, timestamp: Date.parse(tick(id + 1)),
  } });
  const coveredEntryId = message("assistant", [{ type: "text", text: "CURRENT_FINAL_RAREBIT: final answer sentinel" }], "stop");
  const selection = selectRarebits(entries);
  const recapId = push("custom", { customType: "rarebit-recap", data: {
    version: 1, jobId: "mock-recap-job", coveredEntryId, selectionHash: selection.manifestHash,
    heading: "Mock Recap", summary: "RECAP_SHORTCUT_SENTINEL: generic mock recap", sessionStatus: "finished",
    statusReason: "all_requests_accomplished", observedAt: Date.parse(tick(id + 1)),
  } });
  assert.equal(latestRecap(entries)?.id, recapId, "the generic Recap fixture is valid");
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

try {
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const firstSession = mockSession(projectDir);
  await writeFile(sessionFile, firstSession, { mode: 0o600 });
  const secondSession = firstSession
    .replaceAll("rarebit-view-session", "rarebit-second-session")
    .replaceAll("PRECOMPACTION_RAREBIT", "SECOND_PRECOMPACTION_RAREBIT")
    .replaceAll("PRECOMPACTION_HISTORY", "SECOND_PRECOMPACTION_HISTORY")
    .replaceAll("CURRENT_CONTEXT_USER", "SECOND_CONTEXT_USER")
    .replaceAll("CURRENT_CONTEXT_RAREBIT", "SECOND_SESSION_RAREBIT")
    .replaceAll("CURRENT_CONTEXT_ASSISTANT_RAREBIT", "SECOND_CONTEXT_ASSISTANT_RAREBIT")
    .replaceAll("CURRENT_FINAL_RAREBIT", "SECOND_FINAL_RAREBIT")
    .replaceAll("CURRENT_TOOL_OUTPUT_SENTINEL", "SECOND_TOOL_OUTPUT_SENTINEL")
    .replaceAll("CURRENT_THINKING_SENTINEL", "SECOND_THINKING_SENTINEL");
  await writeFile(secondSessionFile, secondSession, { mode: 0o600 });
  const childEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
  const piCommand = [
    "env", `PI_CODING_AGENT_DIR=${agentDir}`, "PI_OFFLINE=1", "PI_TELEMETRY=0",
    process.execPath, piCli, "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--no-themes", "--no-context-files", "--approve", "--extension", fixtureExtension,
    "--session-dir", sessionDir, "--session", sessionFile, "--tui-mode", tuiMode,
  ];
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const guardedCommand = `${piCommand.map(quote).join(" ")}; result=$?; printf '\\nPI_EXIT:%s\\n' "$result"; sleep 30; exit "$result"`;
  const command = [
    "-L", socket, "new-session", "-d", "-x", "120", "-y", "36", "-s", session,
    "/bin/sh", "-c", guardedCommand,
  ];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(tmux, command, { cwd: projectDir, env: childEnv, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`tmux new-session exited ${code}`)));
  });
  await waitFor("mock Session transcript", async () => {
    const output = await pane(socket, session);
    return output.includes("CURRENT_FINAL_RAREBIT") ? output : false;
  });
  await sleep(500);

  const inactive = await pane(socket, session);
  assert.doesNotMatch(inactive, /Rarebit view:/, "the view has no status while off");
  const kitty = (code) => `\u001b[${code};13u`;
  await keys(socket, session, kitty(114));
  const firstToggle = await waitFor("first Ctrl+Super+R opens all", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebits ·") ? output : false;
  });
  assert.match(firstToggle, /Rarebits ·/);
  await keys(socket, session, kitty(110));
  const cycledPeek = await waitFor("Ctrl+Super+N cycles all to peek", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit view: peek · next ctrl+alt+n · off ctrl+alt+r") ? output : false;
  });
  assert.match(cycledPeek, /Rarebits ·/);
  await press(socket, session, "C-u");
  await submitSlash(socket, session, "/rarebit view off");
  await keys(socket, session, kitty(114));
  const rememberedPeek = await waitFor("toggle reopens the last used mode", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit view: peek · next ctrl+alt+n · off ctrl+alt+r") ? output : false;
  });
  assert.match(rememberedPeek, /Rarebits ·/);
  await press(socket, session, "C-u");
  await submitSlash(socket, session, "/rarebit view off");
  await keys(socket, session, kitty(110));
  const cycledContext = await waitFor("Ctrl+Super+N cycles off to context", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit view: context · next ctrl+alt+n · off ctrl+alt+r") ? output : false;
  });
  assert.match(cycledContext, /CURRENT_CONTEXT_RAREBIT/);
  await keys(socket, session, kitty(114));
  await waitFor("Ctrl+Super+R toggles context off", async () => !(await pane(socket, session)).includes("Rarebit view:"));
  await keys(socket, session, kitty(114));
  await waitFor("toggle remembers context", async () => (await pane(socket, session)).includes("Rarebit view: context · next ctrl+alt+n · off ctrl+alt+r"));
  await submitSlash(socket, session, "/rarebit view off");

  await submitSlash(socket, session, "/rarebit help");
  await waitFor("pre-attach command notice", async () => (await pane(socket, session)).includes("Usage: /rarebit"));
  await submitSlash(socket, session, "/rarebit view context");
  const context = await waitFor("context view status", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit view: context") ? output : false;
  });
  assert.match(context, /CURRENT_CONTEXT_RAREBIT/);
  assert.doesNotMatch(context, /Usage: \/rarebit/, "notices from before context attached remain hidden");
  assert.match(context, /CURRENT_FINAL_RAREBIT/);
  assert.equal([...context.matchAll(/Thinking\.\.\./g)].length, 2, "selected prose survives when it equals Pi's thinking label, with and without a thinking block");
  assert.doesNotMatch(context, /THINKING_BLOCK_SENTINEL/);
  assert.match(context, /Compacted from 1,000 tokens/);
  assert.match(context, /RECAP_SHORTCUT_SENTINEL/);
  assert.ok(context.includes("Rarebit view: context · next ctrl+alt+n · off ctrl+alt+r"), "status names the active mode and first shortcuts");
  assert.doesNotMatch(context, /PRECOMPACTION_RAREBIT/);
  assert.doesNotMatch(context, /CURRENT_TOOL_OUTPUT_SENTINEL|CURRENT_THINKING_SENTINEL/);
  await submitSlash(socket, session, "/rarebit status");
  const contextStatusNotice = await waitFor("status notice remains visible in context", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit status:") ? output : false;
  }, 1_500).catch(() => null);
  if (!contextStatusNotice) defects.push("/rarebit status emits no visible status notice while context is active");
  else assert.match(contextStatusNotice, /Rarebit status: view=context/);

  await submitSlash(socket, session, "/rarebit view off");
  const off = await waitFor("view disabled", async () => {
    const output = await pane(socket, session);
    return !output.includes("Rarebit view: context") && output.includes("CURRENT_TOOL_OUTPUT_SENTINEL") ? output : false;
  });
  assert.doesNotMatch(off, /Rarebit view:/, "off clears the view status line");

  await submitSlash(socket, session, "/rarebit view all");
  const initialAll = await waitFor("all view", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebits ·") ? output : false;
  });
  assert.match(initialAll, /ctrl\+alt\+n next/, "all footer advertises the cycle shortcut");
  const initialPosition = initialAll.match(/(\d+-\d+\/\d+)\s*$/m)?.[1];
  await resizeWindow(socket, session, 120, 44);
  const resizedAll = await waitFor("all view adapts to a taller terminal", async () => {
    const output = await pane(socket, session);
    const position = output.match(/(\d+-\d+\/\d+)\s*$/m)?.[1];
    return position && position !== initialPosition ? output : false;
  });
  assert.match(resizedAll, /Rarebits ·/);
  await resizeWindow(socket, session, 120, 36);
  await waitFor("all view adapts after terminal shrinks", async () => {
    const output = await pane(socket, session);
    const position = output.match(/(\d+-\d+\/\d+)\s*$/m)?.[1];
    return position === initialPosition ? output : false;
  });
  await press(socket, session, "C-M-g");
  assert.ok(await waitFor("Recap shortcut does not close all", async () => (await pane(socket, session)).includes("Rarebits ·")));
  await sleep(250);
  const entriesAfterRecapKey = (await readFile(sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(!entriesAfterRecapKey.some((entry) => entry.customType === "rarebit-recap-read"), "Ctrl+Alt+G does not acknowledge a Recap while all is focused");
  await keys(socket, session, "\u001b[114;13u");
  await waitFor("Ctrl+Super+R closes focused all", async () => !(await pane(socket, session)).includes("Rarebits ·"));
  await keys(socket, session, "\u001b[114;13u");
  await waitFor("Ctrl+Super+R reopens focused all", async () => (await pane(socket, session)).includes("Rarebits ·"));
  if (piVersion === "1.0.0" && tuiMode === "fullscreen") {
    await press(socket, session, "g");
    const atStart = (await pane(socket, session)).match(/(\d+-\d+\/\d+)\s*$/m)?.[1];
    await keys(socket, session, "\u001b[<65;60;20M");
    const wheel = await waitFor("fullscreen Pi 1.0 routes wheel scroll to all", async () => {
      const output = await pane(socket, session);
      const position = output.match(/(\d+-\d+\/\d+)\s*$/m)?.[1];
      return position && position !== atStart ? output : false;
    });
    assert.match(wheel, /Rarebits ·/);
  }
  await press(socket, session, "g");
  const all = await waitFor("all view shows older entries and compaction marker", async () => {
    const output = await pane(socket, session);
    return output.includes("PRECOMPACTION_RAREBIT") && /compaction/i.test(output) ? output : false;
  });
  assert.match(all, /PRECOMPACTION_RAREBIT/);
  assert.match(all, /compaction/i);

  // Search must accept both directions, preserve the query for n/N, and show
  // the live query/count in the overlay footer. The source sentinels make the
  // search interaction deterministic without a model or external fixture.
  await press(socket, session, "/");
  await keys(socket, session, "PRECOMPACTION_RAREBIT");
  await press(socket, session, "Enter");
  const forwardSearch = await waitFor("forward search result", async () => {
    const output = await pane(socket, session);
    return output.includes("/PRECOMPACTION_RAREBIT · 1/2 · n/N") ? output : false;
  });
  assert.match(forwardSearch, /PRECOMPACTION_RAREBIT/);
  await press(socket, session, "n");
  const nextMatch = await waitFor("n advances search match", async () => {
    const output = await pane(socket, session);
    return output.includes("/PRECOMPACTION_RAREBIT · 2/2 · n/N") ? output : false;
  });
  assert.match(nextMatch, /2\/2/);
  await press(socket, session, "N");
  const previousMatch = await waitFor("N reverses search match", async () => {
    const output = await pane(socket, session);
    return output.includes("/PRECOMPACTION_RAREBIT · 1/2 · n/N") ? output : false;
  });
  assert.match(previousMatch, /1\/2/);
  await press(socket, session, "N");
  const topWrap = await waitFor("N wrap notice", async () => {
    const output = await pane(socket, session);
    return output.includes("search hit TOP, continuing at BOTTOM") ? output : false;
  });
  assert.match(topWrap, /search hit TOP, continuing at BOTTOM/);
  await press(socket, session, "n");
  const bottomWrap = await waitFor("n wrap notice", async () => {
    const output = await pane(socket, session);
    return output.includes("search hit BOTTOM, continuing at TOP") ? output : false;
  });
  assert.match(bottomWrap, /search hit BOTTOM, continuing at TOP/);
  await press(socket, session, "q");
  await waitFor("close view after wrap checks", async () => !(await pane(socket, session)).includes("Rarebits ·"));
  await submitSlash(socket, session, "/rarebit view all");
  await waitFor("reopen all for reverse search", async () => (await pane(socket, session)).includes("Rarebits ·"));
  await press(socket, session, "?");
  await keys(socket, session, "CURRENT_FINAL_RAREBIT");
  await press(socket, session, "Enter");
  const reverseSearch = await waitFor("reverse search result", async () => {
    const output = await pane(socket, session);
    return output.includes("?CURRENT_FINAL_RAREBIT · 1/1 · n/N") ? output : false;
  });
  assert.match(reverseSearch, /CURRENT_FINAL_RAREBIT/);

  const beforeScroll = await pane(socket, session);
  await press(socket, session, "u");
  const up = await waitFor("up half-page movement", async () => {
    const output = await pane(socket, session);
    return output !== beforeScroll ? output : false;
  });
  await press(socket, session, "d");
  const down = await waitFor("down half-page movement", async () => {
    const output = await pane(socket, session);
    return output !== up ? output : false;
  });
  assert.notEqual(down, up);

  // With the search active, Esc first clears it. The next Esc closes the view.
  await press(socket, session, "Escape");
  const cleared = await waitFor("search cleared without closing overlay", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebits") && output.includes("j/k · u/d") && !output.includes("?CURRENT_FINAL_RAREBIT ·") ? output : false;
  });
  assert.match(cleared, /Rarebits/);
  await press(socket, session, "Escape");
  await waitFor("Escape closes overlay", async () => !(await pane(socket, session)).includes("Rarebits ·"));

  await submitSlash(socket, session, "/rarebit view all");
  await waitFor("all view reopens", async () => (await pane(socket, session)).includes("Rarebits ·"));
  await press(socket, session, "q");
  await waitFor("q closes capturing overlay", async () => !(await pane(socket, session)).includes("Rarebits ·"));

  await submitSlash(socket, session, "/rarebit view peek");
  const peekInitial = await waitFor("peek overlay", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebits ·") && output.includes("Rarebit view: peek") ? output : false;
  });
  assert.match(peekInitial, /keys go to the editor · wheel scrolls · ctrl\+alt\+r closes · replies appear when finished/);
  await submitSlash(socket, session, "/rarebit view");
  const picker = await waitFor("view picker closes peek first", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit view") && !output.includes("Rarebits ·") ? output : false;
  });
  assert.match(picker, /all — All Rarebits/);
  await press(socket, session, "Escape");
  await waitFor("view picker closes", async () => !(await pane(socket, session)).includes("all — All Rarebits"));

  await submitSlash(socket, session, "/rarebit view peek");
  await waitFor("peek reopens before Rarebit palette", async () => (await pane(socket, session)).includes("Rarebits ·"));
  await submitSlash(socket, session, "/rarebit");
  const palette = await waitFor("Rarebit palette closes peek first", async () => {
    const output = await pane(socket, session);
    return output.includes("Human-only command palette") && !output.includes("Rarebits ·") ? output : false;
  });
  assert.match(palette, /Command help/);
  await press(socket, session, "Escape");
  await waitFor("Rarebit palette closes", async () => !(await pane(socket, session)).includes("Human-only command palette"));

  await submitSlash(socket, session, "/rarebit view peek");
  await waitFor("peek reopens before settings", async () => (await pane(socket, session)).includes("Rarebits ·"));
  await submitSlash(socket, session, "/rarebit settings");
  const settings = await waitFor("Rarebit settings closes peek first", async () => {
    const output = await pane(socket, session);
    return output.includes("Rarebit Settings") && !output.includes("Rarebits ·") ? output : false;
  });
  assert.match(settings, /Summary/);
  await press(socket, session, "Escape");
  await waitFor("settings closes", async () => !(await pane(socket, session)).includes("Rarebit Settings"));

  await submitSlash(socket, session, "/rarebit view peek");
  await waitFor("peek reopens for editor check", async () => (await pane(socket, session)).includes("Rarebits ·"));
  await keys(socket, session, "PEEK_EDITOR_INPUT_SENTINEL");
  const peek = await waitFor("editor accepts input with peek open", async () => {
    const output = await pane(socket, session);
    return output.includes("PEEK_EDITOR_INPUT_SENTINEL") && output.includes("Rarebits ·") ? output : false;
  });
  assert.match(peek, /PEEK_EDITOR_INPUT_SENTINEL/);
  assert.match(peek, /Rarebits ·/);
  await press(socket, session, "C-u");
  await submitSlash(socket, session, "/rarebit view off");
  await waitFor("off closes peek view", async () => !(await pane(socket, session)).includes("Rarebits ·"));

  // Pi lifecycle boundaries must dispose the view before a fresh transcript
  // or extension registration appears. Use only built-in /reload and /resume.
  const assertNormalCurrentSession = async (marker, label) => {
    const output = await waitFor(label, async () => {
      const current = await pane(socket, session);
      return current.includes(marker) && !current.includes("Rarebits ·") && !current.includes("Rarebit view:") ? current : false;
    });
    assert.match(output, new RegExp(marker));
    assert.doesNotMatch(output, /Rarebits ·|Rarebit view:/);
    return output;
  };
  await submitSlash(socket, session, "/rarebit view context");
  await waitFor("context active before reload", async () => (await pane(socket, session)).includes("Rarebit view: context"));
  await submitSlash(socket, session, "/reload");
  await assertNormalCurrentSession("CURRENT_TOOL_OUTPUT_SENTINEL", "reload resets context to normal transcript");
  await submitSlash(socket, session, "/rarebit view context");
  await waitFor("context active before Session switch", async () => (await pane(socket, session)).includes("Rarebit view: context"));
  await submitSlash(socket, session, "/resume");
  await waitFor("Session picker shows second mock", async () => (await pane(socket, session)).includes("SECOND_PRECOMPACTION_RAREBIT"));
  await keys(socket, session, "SECOND_PRECOMPACTION_RAREBIT");
  await sleep(250);
  await press(socket, session, "Enter");
  await assertNormalCurrentSession("SECOND_FINAL_RAREBIT", "Session switch resets context to second normal transcript");
  await submitSlash(socket, session, "/rarebit view context");
  const secondContext = await waitFor("reopened context shows second Session", async () => {
    const output = await pane(socket, session);
    return output.includes("SECOND_SESSION_RAREBIT") && output.includes("Rarebit view: context") ? output : false;
  });
  assert.match(secondContext, /SECOND_SESSION_RAREBIT/);
  assert.doesNotMatch(secondContext, /CURRENT_CONTEXT_RAREBIT|Rarebits ·/);
  await submitSlash(socket, session, "/rarebit view peek");
  await waitFor("peek active before second Session switch", async () => (await pane(socket, session)).includes("Rarebit view: peek"));
  await submitSlash(socket, session, "/resume");
  await waitFor("Session picker shows first mock", async () => (await pane(socket, session)).includes("PRECOMPACTION_RAREBIT"));
  await keys(socket, session, "PRECOMPACTION_RAREBIT");
  await sleep(250);
  await press(socket, session, "Enter");
  await assertNormalCurrentSession("CURRENT_FINAL_RAREBIT", "Session switch resets peek to first normal transcript");
  await submitSlash(socket, session, "/rarebit view peek");
  const firstPeek = await waitFor("reopened peek shows first Session", async () => {
    const output = await pane(socket, session);
    return output.includes("CURRENT_FINAL_RAREBIT") && output.includes("Rarebit view: peek") ? output : false;
  });
  assert.doesNotMatch(firstPeek, /SECOND_FINAL_RAREBIT/);
  await submitSlash(socket, session, "/reload");
  await assertNormalCurrentSession("CURRENT_TOOL_OUTPUT_SENTINEL", "reload resets peek to normal transcript");

  const finalOff = await waitFor("status absent after off", async () => {
    const output = await pane(socket, session);
    return !output.includes("Rarebit view:") ? output : false;
  });
  assert.doesNotMatch(finalOff, /Rarebit view:/);
  const assertions = ["R1 selected Thinking... prose with and without thinking blocks", "R2 context hides pre-attach notices and keeps /rarebit status", "context filters tool/thinking rows and shows Recap beside compaction", "R3 all footer cycle hint", "R4 search wrap notices and / ? n N", "first toggle defaults to all", "Ctrl+Super+R/N Kitty sequences", "preferred mode restored on toggle", "resize-aware all layout", "u/d scroll", "Esc clears then closes; q closes", "peek editor input and footer", "picker, palette, and settings close view", "R6 /reload and Session switch reset context/peek; reopen shows current Session", "off clears status"];
  if (piVersion === "1.0.0" && tuiMode === "fullscreen") assertions.push("fullscreen wheel scrolling");
  console.log(JSON.stringify({ ok: defects.length === 0, pi: piVersion, tuiMode, assertions, defects }));
  if (defects.length) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, pi: piVersion, tuiMode, completedAssertions: ["R1 selected Thinking... prose", "R2 pre-attach notice hidden", "context Recap and compaction visible", "R3 footer cycle hint", "R4 both search wrap notices", "R6 /reload reset"], defects: [...defects, error?.message ?? String(error)] }));
  process.exitCode = 1;
} finally {
  await execFile(tmux, ["-L", socket, "kill-server"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
