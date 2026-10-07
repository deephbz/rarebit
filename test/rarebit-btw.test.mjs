import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RAREBIT_BTW_PANE_LABEL,
  completedBranchPrefix,
  openRarebitBtwPane,
  prepareRarebitBtw,
  watchRarebitBtwPane,
} from "../src/rarebit-btw.mjs";
import { getRarebitArgumentCompletions, parseRarebitCommand } from "../src/rarebit-command.mjs";
import { resolveRarebitSettings } from "../src/rarebit-settings.mjs";

const user = (id, parentId, text) => ({
  type: "message", id, parentId, timestamp: "2026-10-07T00:00:00.000Z",
  message: { role: "user", content: text, timestamp: 0 },
});
const assistant = (id, parentId, content, stopReason = "stop") => ({
  type: "message", id, parentId, timestamp: "2026-10-07T00:00:01.000Z",
  message: { role: "assistant", content, stopReason, timestamp: 0 },
});
const toolResult = (id, parentId, toolCallId) => ({
  type: "message", id, parentId, timestamp: "2026-10-07T00:00:02.000Z",
  message: { role: "toolResult", toolCallId, toolName: "read", content: [], timestamp: 0 },
});

const settledBranch = [
  user("u1", null, "synthetic request alpha"),
  assistant("a1", "u1", [{ type: "toolCall", id: "c1", name: "read", arguments: {} }], "toolUse"),
  toolResult("t1", "a1", "c1"),
  assistant("a2", "t1", [{ type: "text", text: "synthetic reply alpha" }]),
];

function contextFor(branch, sessionFile = "/synthetic/source.jsonl") {
  return {
    cwd: "/synthetic/cwd",
    model: { provider: "synthetic", id: "model", contextWindow: 100_000 },
    sessionManager: {
      getSessionFile: () => sessionFile,
      getBranch: () => branch,
      getHeader: () => ({ type: "session", version: 3, id: "source-id", cwd: "/synthetic/cwd" }),
    },
  };
}

test("btw parses leading flags in any order before the question", () => {
  const parsed = (input) => {
    const { flags, arguments: rest } = parseRarebitCommand(input);
    return { flags, rest };
  };
  assert.deepEqual(parsed("btw"), { flags: [], rest: [] });
  assert.deepEqual(parsed("btw why X?"), { flags: [], rest: ["why X?"] });
  assert.deepEqual(parsed("btw --rarebits"), { flags: ["--rarebits"], rest: [] });
  assert.deepEqual(parsed("btw --readonly --rarebits why --rarebits?"), { flags: ["--readonly", "--rarebits"], rest: ["why --rarebits?"] });
});

test("btw autocompletes unused flags until the question starts", () => {
  const values = (prefix) => getRarebitArgumentCompletions(prefix)?.map(({ value }) => value) ?? null;
  assert.deepEqual(values("btw "), ["btw --rarebits ", "btw --readonly "]);
  assert.deepEqual(values("btw --ra"), ["btw --rarebits "]);
  assert.deepEqual(values("btw --rarebits "), ["btw --rarebits --readonly "]);
  assert.equal(values("btw --rarebits --readonly "), null);
  assert.equal(values("btw why "), null);
});

test("rarebit.btw.model is optional and validated like rarebit.model", () => {
  assert.equal(resolveRarebitSettings({ rarebit: { model: "a/b" } }).btwModel, undefined);
  assert.deepEqual(resolveRarebitSettings({ rarebit: { btw: { model: "p/m:low" } } }).btwModel, { provider: "p", id: "m:low" });
  assert.match(resolveRarebitSettings({ rarebit: { btw: { model: "bad" } } }).btwModelConfigurationError, /rarebit\.btw\.model/);
});

test("a mid-turn snapshot drops the assistant message with unresolved tool calls", () => {
  const pending = assistant("a3", "a2", [{ type: "toolCall", id: "c2", name: "read", arguments: {} }], "toolUse");
  assert.deepEqual(completedBranchPrefix([...settledBranch, pending]).map((e) => e.id), ["u1", "a1", "t1", "a2"]);
  assert.equal(completedBranchPrefix(settledBranch), settledBranch);
});

test("full BTW writes the active branch under a new Session and a self-deleting launcher", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rarebit-btw-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const btw = await prepareRarebitBtw(contextFor(settledBranch), {
    question: "what was alpha?", tempRoot, thinking: "low", activeTools: ["read", "bash", "team_sync"],
  });
  const lines = (await readFile(btw.sessionFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].type, "session");
  assert.notEqual(lines[0].id, "source-id");
  assert.equal(lines[0].parentSession, "/synthetic/source.jsonl");
  assert.deepEqual(lines.slice(1).map((e) => e.id), ["u1", "a1", "t1", "a2"]);
  assert.equal((await stat(btw.directory)).mode & 0o777, 0o700);
  const launcher = await readFile(btw.launcherPath, "utf8");
  assert.match(launcher, /trap .*rm -rf .*hc-rarebit-btw-.* EXIT/);
  for (const flag of ["--tools' 'read,bash,team_sync", "--model' 'synthetic/model", "--thinking' 'low", "'--' 'what was alpha?'"])
    assert.ok(launcher.includes(flag), flag);
  assert.ok(!launcher.includes("--no-extensions"));
  await btw.discard();
});

test("read-only BTW drops extensions and limits tools; a configured model drops parent thinking", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rarebit-btw-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const btw = await prepareRarebitBtw(contextFor(settledBranch), {
    tempRoot, readonly: true, thinking: "high", activeTools: ["bash"], model: { provider: "p", id: "m:low" },
  });
  const launcher = await readFile(btw.launcherPath, "utf8");
  for (const flag of ["--tools' 'read,grep,find,ls", "--no-extensions", "--no-mcp", "--model' 'p/m:low", "Do not modify files"])
    assert.ok(launcher.includes(flag), flag);
  assert.ok(!launcher.includes("--thinking"));
  assert.ok(!launcher.includes("bash"));
});

test("Rarebits BTW keeps only user requests and final replies", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rarebit-btw-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const btw = await prepareRarebitBtw(contextFor(settledBranch), { mode: "rarebits", tempRoot });
  const texts = (await readFile(btw.sessionFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "message" && entry.rarebitFork?.kind === "import")
    .map((entry) => entry.message.role);
  assert.deepEqual(texts, ["user", "assistant"]);
  assert.doesNotMatch(await readFile(btw.launcherPath, "utf8"), /' '--' '/);
});

test("the pane opener replaces another BTW pane in the same tab only, never its own", async () => {
  const calls = [];
  const replies = {
    "pane get": { result: { pane: { tab_id: "tab-1" } } },
    "pane list": { result: { panes: [
      { pane_id: "old", tab_id: "tab-1", label: RAREBIT_BTW_PANE_LABEL },
      { pane_id: "other-tab", tab_id: "tab-2", label: RAREBIT_BTW_PANE_LABEL },
      { pane_id: "main", tab_id: "tab-1", label: RAREBIT_BTW_PANE_LABEL },
    ] } },
    "pane split": { result: { pane: { pane_id: "new" } } },
  };
  const run = async (_bin, args) => {
    calls.push(args.join(" "));
    return { stdout: JSON.stringify(replies[args.slice(0, 2).join(" ")] ?? {}) };
  };
  const opened = await openRarebitBtwPane({ launcherPath: "/tmp/x/launch.sh", cwd: "/w", paneId: "main", run });
  assert.equal(opened.paneId, "new");
  assert.deepEqual(calls.filter((c) => c.startsWith("pane close")), ["pane close old"]);
  assert.ok(calls.includes(`pane rename new ${RAREBIT_BTW_PANE_LABEL}`));
  assert.ok(calls.includes("pane run new exec sh '/tmp/x/launch.sh'"));
});

test("the cleanup watcher is detached and removes the snapshot after the pane is gone", () => {
  let spawned;
  watchRarebitBtwPane({
    paneId: "w1:p1", directory: "/tmp/hc-rarebit-btw-x", herdrBin: "herdr",
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return { unref() {} };
    },
  });
  assert.equal(spawned.options.detached, true);
  assert.match(spawned.args[1], /while \[ -d '\/tmp\/hc-rarebit-btw-x' \] && 'herdr' pane get 'w1:p1'.*done; rm -rf '\/tmp\/hc-rarebit-btw-x'/);
});
