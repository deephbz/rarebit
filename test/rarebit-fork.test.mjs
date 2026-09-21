import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import {
  buildRarebitForkPlan,
  checkRarebitForkHeadroom,
  createRarebitForkEntries,
} from "../src/rarebit-fork.mjs";
import {
  getImportedRarebitEntryIds,
  getRarebitForkSeedEntryIds,
} from "../src/rarebit-fork-lineage.mjs";
import { projectRarebitSessionActivity } from "../src/rarebit-activity.mjs";
import registerPiRarebit from "../src/extension.mjs";

const entry = (id, message, order) => ({
  type: "message", id, parentId: order ? `e${order - 1}` : null,
  timestamp: `2026-09-21T00:00:0${order}.000Z`, message,
});

test("fork keeps a maximal newest suffix under aggregate chars/4 and preserves outcomes", () => {
  const branch = [
    entry("e0", { role: "user", content: "old" }, 0),
    entry("e1", { role: "assistant", stopReason: "toolUse", content: "middle" }, 1),
    entry("e2", { role: "assistant", stopReason: "stop", content: "newest" }, 2),
  ];
  const plan = buildRarebitForkPlan({
    header: { id: "source", cwd: "/source" }, sessionFile: "/source/s.jsonl",
    cwd: "/source", branch, targetCwd: "/target", maxTokenLength: 2,
    targetModel: { provider: "test", id: "target", contextWindow: 100_000 },
    reserveTokens: 16_384,
  });
  assert.deepEqual(plan.selected.map((item) => item.sourceEntryId), ["e2"]);
  assert.equal(plan.importedTokens, 2);
  const built = createRarebitForkEntries(plan, { sessionId: "forked" });
  const imported = built.entries.filter((item) => item.rarebitFork?.kind === "import");
  assert.equal(imported[0].message.stopReason, "stop");
  assert.equal(imported[0].message.provider, "rarebit-import");
  assert.equal(imported[0].timestamp, plan.forkCreatedAt);
  const modelChange = built.entries.at(-1);
  assert.equal(modelChange.type, "model_change");
  assert.deepEqual({ provider: modelChange.provider, id: modelChange.modelId }, { provider: "test", id: "target" });
  assert.deepEqual(getImportedRarebitEntryIds(built.entries), new Set([built.entries[0].id, imported[0].id]));
  assert.deepEqual(getRarebitForkSeedEntryIds(built.entries), new Set([built.entries[0].id]));
});

test("fork marker stays machine-only in Pi context and activity excludes seeded entries", () => {
  const branch = [entry("e0", { role: "user", content: "source" }, 0)];
  const plan = buildRarebitForkPlan({
    header: { id: "source", cwd: "/source" }, sessionFile: "/source/s.jsonl", cwd: "/source",
    branch, targetCwd: "/target", targetModel: { provider: "test", id: "target", contextWindow: 100_000 },
  });
  const built = createRarebitForkEntries(plan, { sessionId: "forked" });
  const seeded = built.entries[0];
  assert.equal(sessionEntryToContextMessages(seeded)[0].role, "user");
  assert.equal("rarebitFork" in sessionEntryToContextMessages(seeded)[0], false);
  const activity = projectRarebitSessionActivity({ ...({ occurrences: [{ sourceEntryId: seeded.id, role: "user", outcome: "user", timestamp: seeded.timestamp }] }), entries: built.entries });
  assert.equal(activity.latestUser, null);
});

test("repeat forks preserve marker ancestry and apostrophe-safe PiQ recovery", () => {
  const sourceBranch = [entry("e0", { role: "user", content: "source" }, 0)];
  const sourcePlan = buildRarebitForkPlan({ header: { id: "source", cwd: "/source" }, sessionFile: "/tmp/a'b.jsonl", cwd: "/source", branch: sourceBranch, targetCwd: "/target", targetModel: { provider: "test", id: "target", contextWindow: 100_000 } });
  const first = createRarebitForkEntries(sourcePlan, { sessionId: "first" });
  const secondPlan = buildRarebitForkPlan({ header: first.header, sessionFile: "/target/first.jsonl", cwd: "/target", branch: first.entries.slice(0, -2), targetCwd: "/target", targetModel: { provider: "test", id: "target", contextWindow: 100_000 } });
  assert.equal(secondPlan.selected.length, 1);
  const second = createRarebitForkEntries(secondPlan, { sessionId: "second" });
  assert.equal(second.manifest.mappings[0].ancestry.length, 2);
  assert.equal(second.manifest.mappings[0].ancestry[0].sessionId, "source");
  assert.equal(second.manifest.mappings[0].ancestry[1].sessionId, "first");
  const recovery = first.entries[0].message.content.split("\n").find((line) => line.startsWith("Recover source"));
  const command = recovery.slice(recovery.indexOf(": ") + 2).replace(/^piq entries/, "set --");
  const shell = spawnSync("sh", ["-c", `${command}; printf '%s' \"$2\"`], { encoding: "utf8" });
  assert.equal(shell.status, 0);
  assert.equal(shell.stdout, "/tmp/a'b.jsonl");
});

test("tool schema overhead can refuse when prose and prompt alone fit", () => {
  assert.doesNotThrow(() => checkRarebitForkHeadroom({ seedText: "x", contextWindow: 100, reserveTokens: 90, promptOverheadTokens: 8, toolOverheadTokens: 0 }));
  assert.throws(() => checkRarebitForkHeadroom({ seedText: "x", contextWindow: 100, reserveTokens: 90, promptOverheadTokens: 8, toolOverheadTokens: 3 }), /headroom|reserve/i);
});

test("slash fork counts active Pi tool schemas before writing or switching", async () => {
  const commands = new Map();
  let switched = false;
  const notifications = [];
  const pi = {
    on: () => {},
    registerCommand: (name, command) => commands.set(name, command),
    getActiveTools: () => ["large_tool"],
    getAllTools: () => [{ name: "large_tool", description: "tool", parameters: { type: "object", properties: { payload: { type: "string", description: "x".repeat(2_000) } } } }],
  };
  registerPiRarebit(pi, { settingsLoader: async () => ({ reserveTokens: 0 }) });
  const branch = [entry("source-entry", { role: "user", content: "source" }, 0)];
  const ctx = {
    hasUI: true, cwd: "/tmp", model: { provider: "test", id: "target", contextWindow: 100 },
    getSystemPrompt: () => "", getActiveTools: () => ["large_tool"],
    waitForIdle: async () => {}, isIdle: () => true,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
    switchSession: async () => { switched = true; return { cancelled: false }; },
    sessionManager: {
      getSessionFile: () => "/tmp/source.jsonl", getHeader: () => ({ id: "source" }), getBranch: () => branch,
      getLeafId: () => "source-entry", getSessionDir: () => "/tmp",
    },
  };
  await commands.get("rarebit").handler("fork", ctx);
  assert.equal(switched, false);
  ctx.model = null;
  await commands.get("rarebit").handler("fork", ctx);
  assert.equal(switched, false);
  assert.match(notifications.at(-1).message, /destination model\/context window is unavailable/);
});

test("headroom refuses before a destination can be switched", () => {
  assert.throws(() => buildRarebitForkPlan({
    header: { id: "source" }, sessionFile: "/source/s.jsonl", branch: [entry("e0", { role: "user", content: "x" }, 0)],
    maxTokenLength: 10, targetModel: { provider: "test", id: "tiny", contextWindow: 10 }, reserveTokens: 9,
  }), /headroom|reserve/i);
});
