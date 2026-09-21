import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readPiSession } from "../src/pi-session.mjs";
import {
  queryPiQ,
  queryPiSessionBranches,
} from "../src/piq.mjs";
import { parsePiQCliArgs } from "../src/piq-cli.mjs";

const records = [
  {
    type: "session",
    version: 3,
    id: "piq-fixture",
    timestamp: "2026-09-21T00:00:00.000Z",
    cwd: "/private/project",
    unknownHeader: { retained: true },
  },
  {
    type: "message",
    id: "root",
    parentId: null,
    timestamp: "2026-09-21T00:00:01.000Z",
    message: { role: "user", content: "root" },
    unknownEntryField: "kept",
    _piq: { source: "native" },
  },
  {
    type: "message",
    id: "tool-call",
    parentId: "root",
    timestamp: "2026-09-21T00:00:02.000Z",
    message: {
      role: "assistant",
      content: [
        "unknown-content-block",
        { type: "text", text: "calling" },
        { type: "toolCall", id: "call-1", name: "search", arguments: { q: "x" } },
      ],
    },
  },
  {
    type: "compaction",
    id: "compact",
    parentId: "tool-call",
    timestamp: "2026-09-21T00:00:03.000Z",
    firstKeptEntryId: "tool-call",
    summary: "older context",
    futureField: { retained: "raw" },
  },
  {
    type: "message",
    id: "tool-result",
    parentId: "compact",
    timestamp: "2026-09-21T00:00:04.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "result" }],
    },
  },
  {
    type: "message",
    id: "active",
    parentId: "tool-result",
    timestamp: "2026-09-21T00:00:05.000Z",
    message: { role: "assistant", stopReason: "stop", content: "done" },
  },
  {
    type: "message",
    id: "sibling",
    parentId: "root",
    timestamp: "2026-09-21T00:00:06.000Z",
    message: { role: "user", content: "sibling" },
  },
];

async function fixture(testContext) {
  const root = await mkdtemp(join(tmpdir(), "piq-"));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "session.jsonl");
  const source = records.map(JSON.stringify).join("\n") + "\n";
  await writeFile(file, source);
  return { file, root, source };
}

test("generic reader resolves the default and explicit branches without timestamps", async (t) => {
  const { file } = await fixture(t);
  const loaded = await readPiSession(file);
  assert.deepEqual(loaded.branch.map((entry) => entry.id), ["root", "sibling"]);
  const active = await readPiSession(file, { leafId: "active" });
  assert.deepEqual(active.branch.map((entry) => entry.id), [
    "root",
    "tool-call",
    "compact",
    "tool-result",
    "active",
  ]);
  const branches = queryPiSessionBranches(active);
  assert.deepEqual(
    branches.map((branch) => branch.leafId),
    ["active", "sibling"],
  );
});

test("PiQ preserves raw fields and filters evidence", async (t) => {
  const { file, source } = await fixture(t);
  const entries = await queryPiQ(file, { kind: "entries", leafId: "active" });
  assert.equal(entries[0].entry.unknownEntryField, "kept");
  assert.equal(entries[0].entry._piq.source, "native");
  assert.equal(entries[1]._piq.branchLeafId, "active");
  const roles = await queryPiQ(file, { kind: "entries", leafId: "active", role: "toolResult" });
  assert.deepEqual(roles.map((record) => record.entry.id), ["tool-result"]);
  const tools = await queryPiQ(file, { kind: "tools", leafId: "active" });
  assert.deepEqual(tools.map((record) => record._piq.kind), ["tool-call", "tool-result"]);
  assert.equal(tools[0]._piq.blockIndex, 2);
  const boundaries = await queryPiQ(file, { kind: "compactions", leafId: "active" });
  assert.equal(boundaries[0].entry.futureField.retained, "raw");
  const filteredBoundary = await queryPiQ(file, {
    kind: "compactions",
    leafId: "active",
    entryId: "compact",
    from: "2026-09-21T00:00:03.000Z",
    to: "2026-09-21T00:00:03.000Z",
  });
  assert.equal(filteredBoundary.length, 1);
  const prior = await queryPiQ(file, {
    kind: "entries",
    leafId: "active",
    throughCompaction: "compact",
  });
  assert.deepEqual(prior.map((record) => record.entry.id), ["root", "tool-call", "compact"]);
  const dated = await queryPiQ(file, {
    kind: "entries",
    leafId: "active",
    from: "2026-09-21T00:00:04.000Z",
  });
  assert.deepEqual(dated.map((record) => record.entry.id), ["tool-result", "active"]);
  const epochRange = await queryPiQ(file, {
    kind: "entries",
    leafId: "active",
    from: "1970-01-01T00:00:00.000Z",
    to: "1970-01-01T00:00:00.000Z",
  });
  assert.deepEqual(epochRange, []);
  assert.equal(await readFile(file, "utf8"), source);
});

test("PiQ CLI emits JSONL and rejects malformed or ambiguous branch choices", async (t) => {
  const { file, root } = await fixture(t);
  const parsed = parsePiQCliArgs([
    "entries",
    "--session",
    file,
    "--leaf",
    "sibling",
    "--role",
    "user",
  ]);
  assert.equal(parsed.leafId, "sibling");
  const cli = new URL("../bin/piq.mjs", import.meta.url);
  const output = spawnSync(
    process.execPath,
    [cli.pathname, "entries", "--session", file, "--leaf", "sibling"],
    { encoding: "utf8" },
  );
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(
    output.stdout.trim().split("\n").map((line) => JSON.parse(line).entry.id),
    ["root", "sibling"],
  );
  const unsupported = spawnSync(
    process.execPath,
    [cli.pathname, "branches", "--session", file, "--role", "user"],
    { encoding: "utf8" },
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Branch listing does not support filters/);
  await assert.rejects(
    queryPiQ(file, { kind: "entries", leafId: "missing" }),
    /no Session entry with leaf ID missing/i,
  );
  await assert.rejects(
    queryPiQ(file, { kind: "entries", from: "not-a-date" }),
    /ISO-8601 timestamp/,
  );
  await assert.rejects(
    queryPiQ(file, { kind: "branches", role: "user" }),
    /does not support filters/,
  );
  await assert.rejects(
    queryPiQ(file, { kind: "branches", leafId: "active" }),
    /does not support --leaf/,
  );
  const malformed = join(root, "malformed.jsonl");
  await writeFile(malformed, `${JSON.stringify(records[0])}\n{bad\n`);
  await assert.rejects(queryPiQ(malformed), /malformed JSON/);
  const cycle = join(root, "cycle.jsonl");
  await writeFile(
    cycle,
    [
      { type: "session", version: 3, id: "cycle" },
      { type: "message", id: "a", parentId: "b", message: { role: "user", content: "a" } },
      { type: "message", id: "b", parentId: "a", message: { role: "user", content: "b" } },
    ].map(JSON.stringify).join("\n"),
  );
  await assert.rejects(queryPiQ(cycle, { kind: "branches" }), /cycle/);
});
