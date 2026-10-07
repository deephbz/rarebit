#!/usr/bin/env node
/**
 * Live Rarebit BTW canary in Herdr with the installed Pi and a real model.
 *
 * Uses only synthetic Session prose in a disposable directory. It opens an
 * unfocused Herdr tab, starts Pi with this Rarebit checkout on the synthetic
 * Session, types `/rarebit btw ...`, and checks that the side pane answers a
 * question that needs the history but is not a copy of it. It then checks
 * pane replacement and snapshot cleanup.
 *
 * Env: RAREBIT_BTW_E2E_MODEL (default magpie/claude/claude-haiku-4-5).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const herdrBin = process.env.HERDR_BIN_PATH || "herdr";
const model = process.env.RAREBIT_BTW_E2E_MODEL ?? "magpie/claude/claude-haiku-4-5";
const LABEL = "rarebit-btw";

const herdr = (...args) => {
  const out = execFileSync(herdrBin, args, { encoding: "utf8", timeout: 120_000 });
  return out.trim() ? JSON.parse(out) : {};
};
const herdrText = (...args) => execFileSync(herdrBin, args, { encoding: "utf8", timeout: 120_000 });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function assistantMessage(text) {
  return {
    role: "assistant", content: [{ type: "text", text }], api: "synthetic", provider: "synthetic",
    model: "synthetic", stopReason: "stop", timestamp: Date.parse("2026-10-07T00:00:02Z"),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

async function syntheticSession(directory) {
  const file = join(directory, "source.jsonl");
  const lines = [
    { type: "session", version: 3, id: "btw-e2e-source", timestamp: "2026-10-07T00:00:00.000Z", cwd: directory },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-10-07T00:00:01.000Z",
      message: { role: "user", content: "Plan: the synthetic deploy window opens at 14:30 UTC and lasts 95 minutes.", timestamp: Date.parse("2026-10-07T00:00:01Z") } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-10-07T00:00:02.000Z",
      message: assistantMessage("Noted the synthetic deploy window plan.") },
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

const btwPanes = (tabId) => herdr("pane", "list").result.panes
  .filter((pane) => pane.tab_id === tabId && pane.label === LABEL);

async function waitForBtwPane(tabId, exclude, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pane = btwPanes(tabId).find((candidate) => candidate.pane_id !== exclude);
    if (pane) return pane.pane_id;
    await sleep(250);
  }
  throw new Error("no BTW pane appeared");
}

async function snapshotDirs() {
  return new Set((await readdir(tmpdir())).filter((name) => name.startsWith("hc-rarebit-btw-")));
}

async function ask(mainPane, tabId, command, previousPane) {
  const before = await snapshotDirs();
  herdrText("pane", "send-text", mainPane, command);
  herdrText("pane", "send-keys", mainPane, "Enter");
  const pane = await waitForBtwPane(tabId, previousPane);
  herdrText("pane", "wait-output", pane, "--regex", "ANSWER\\s*=\\s*16:05", "--timeout", "120000");
  const created = [...await snapshotDirs()].filter((name) => !before.has(name));
  assert.equal(created.length, 1, "one private snapshot per BTW");
  herdrText("pane", "wait-output", mainPane, "--match", "Rarebit BTW opened", "--timeout", "10000");
  const snapshot = join(tmpdir(), created[0]);
  return { pane, snapshot, launcher: await readFile(join(snapshot, "launch.sh"), "utf8") };
}

const work = await mkdtemp(join(tmpdir(), "rarebit-btw-e2e-"));
let tabId;
try {
  const source = await syntheticSession(work);
  const tab = herdr("tab", "create", "--no-focus", "--cwd", work, "--label", "rarebit-btw-e2e");
  tabId = tab.result.tab.tab_id;
  const mainPane = tab.result.root_pane.pane_id;
  herdrText("pane", "run", mainPane, [
    "pi", "--session", source, "--no-extensions", "-e", join(packageRoot, "src/extension.mjs"),
    "--model", model, "--no-skills", "--no-context-files", "--no-mcp",
  ].map(quote).join(" "));
  herdrText("pane", "wait-output", mainPane, "--match", "deploy window", "--timeout", "60000");
  await sleep(1500);

  const question = "When does the deploy window close? Reply exactly as ANSWER=HH:MM";
  const rarebits = await ask(mainPane, tabId, `/rarebit btw --rarebits --readonly ${question}`);
  assert.match(rarebits.launcher, /'--no-extensions'.*'--tools' 'read,grep,find,ls'|'--tools' 'read,grep,find,ls'.*'--no-extensions'/s);
  console.log(`ok read-only Rarebits BTW answered in ${rarebits.pane}`);

  const full = await ask(mainPane, tabId, `/rarebit btw ${question}`, rarebits.pane);
  assert.deepEqual(btwPanes(tabId).map((pane) => pane.pane_id), [full.pane], "the new BTW replaced the old one");
  assert.match(full.launcher, /'--tools' '[^']*read[^']*bash/, "full BTW inherits the parent's active tools");
  assert.doesNotMatch(full.launcher, /--no-extensions/);
  const replacedName = rarebits.snapshot.split("/").at(-1);
  for (const deadline = Date.now() + 15_000; (await snapshotDirs()).has(replacedName) && Date.now() < deadline;) await sleep(500);
  assert.ok(!(await snapshotDirs()).has(replacedName), "replaced BTW deleted its snapshot");
  console.log(`ok full BTW with inherited tools answered in ${full.pane} and replaced the earlier pane`);

  herdrText("pane", "close", full.pane);
  const name = full.snapshot.split("/").at(-1);
  const deadline = Date.now() + 15_000;
  while ((await snapshotDirs()).has(name) && Date.now() < deadline) await sleep(500);
  assert.ok(!(await snapshotDirs()).has(name), "closed BTW deleted its snapshot");
  console.log("ok closing the BTW pane deleted its snapshot");
} catch (error) {
  if (tabId) {
    for (const pane of herdr("pane", "list").result.panes.filter((p) => p.tab_id === tabId))
      console.error(`--- ${pane.pane_id} ${pane.label ?? ""}\n${herdrText("pane", "read", pane.pane_id, "--source", "recent-unwrapped").split("\n").slice(-25).join("\n")}`);
  }
  throw error;
} finally {
  if (tabId) try { herdrText("tab", "close", tabId); } catch {}
  await rm(work, { recursive: true, force: true });
}
