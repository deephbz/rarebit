import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
} from "node:fs/promises";
import Ajv from "ajv";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  processRarebitSummary,
  processRarebitTitle,
} from "../src/rarebit-service.mjs";
import {
  readRarebitCurrent,
  readRarebitHistory,
  releaseRarebitJob,
  reserveRarebitJob,
  settleRarebitJob,
} from "../src/rarebit-store.mjs";
import { selectRarebits, sha256 } from "../src/rarebit-core.mjs";
import { extractRarebitSynthesisReceipt } from "../src/rarebit-model.mjs";
import {
  exactSelectionApplies,
  requestPrefixApplies,
  validateRarebitArtifactReceipt,
} from "../src/rarebit-artifact-state.mjs";

const entry = (id, role, content) => ({
  id,
  type: "message",
  message: {
    role,
    content,
    stopReason: role === "assistant" ? "stop" : undefined,
  },
});
async function fixture(name = "session") {
  const root = await mkdtemp(join(tmpdir(), "rarebit-sidecar-"));
  const sessionRoot = join(root, "sessions");
  const rarebitRoot = join(root, "rarebit");
  const dir = join(sessionRoot, name);
  await mkdir(dir, { recursive: true });
  const sessionFile = join(dir, "trace.jsonl");
  await writeFile(sessionFile, "{}\n");
  return { root, sessionRoot, rarebitRoot, sessionFile };
}
async function materialize(f, branch, id = "s", options = {}) {
  await writeFile(
    f.sessionFile,
    [
      JSON.stringify({ type: "session", id }),
      ...branch.map((value) => JSON.stringify(value)),
    ].join("\n") + "\n",
  );
  return processRarebitSummary(
    {
      sessionManager: {
        getHeader: () => ({ id }),
        getSessionFile: () => f.sessionFile,
        getBranch: () => branch,
      },
    },
    {
      sessionRoot: f.sessionRoot,
      rarebitRoot: f.rarebitRoot,
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
      model: { provider: "test", id: "model" },
      modelClient: {
        complete: async () =>
          JSON.stringify({
            summary: "ok",
            sessionStatus: "finished",
            statusReason: "all_requests_accomplished",
          }),
      },
      ...options,
    },
  );
}
function compactReceipt(branch, sessionId = "s") {
  const selected = selectRarebits(branch);
  const latestUser = selected.occurrences
    .filter((value) => value.role === "user")
    .at(-1);
  const model = { provider: "test", id: "model" };
  const observedAt = "2026-07-26T00:00:00.000Z";
  return {
    schemaVersion: 4,
    type: "rarebit_summary",
    status: "ok",
    jobId: "0".repeat(64),
    sessionId,
    branch: {
      leafId: branch.at(-1)?.id ?? null,
      entryCount: branch.length,
      pathHash: sha256(branch.map((value) => String(value?.id ?? ""))),
    },
    observedAt,
    selection: {
      manifestHash: selected.manifestHash,
      selectorVersion: selected.manifest.selectorVersion,
      occurrenceCount: selected.occurrences.length,
      uniquePayloadCount: selected.payloads.length,
      latestUserSourceEntryId: latestUser?.sourceEntryId ?? null,
    },
    lifecycleBoundary: "manual",
    implementationVersion: "hc-rarebit-summary-v4",
    synthesisMode: "forced",
    inputCoveragePolicy: {
      strategy: "complete_or_explicit_overflow",
      maxPromptChars: 1_000,
    },
    promptVersion: "rarebit-summary-v4",
    model,
    modelProvenance: { source: "test", status: "resolved" },
    summary: "ok",
    sessionStatus: "finished",
    statusReason: "all_requests_accomplished",
    synthesis: extractRarebitSynthesisReceipt(
      {},
      {
        requestedModel: model,
        startedAt: observedAt,
        completedAt: observedAt,
        durationMs: 0,
      },
    ),
  };
}
test("current store reads a valid historical session_start receipt", async () => {
  const f = await fixture();
  const branch = [entry("u", "user", "historical evidence")];
  await writeFile(
    f.sessionFile,
    [
      JSON.stringify({ type: "session", id: "s" }),
      ...branch.map((value) => JSON.stringify(value)),
    ].join("\n") + "\n",
  );
  const reservation = await reserveRarebitJob({
    jobId: "1".repeat(64),
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  await settleRarebitJob(reservation, {
    ...compactReceipt(branch),
    lifecycleBoundary: "session_start",
    synthesisMode: "automatic",
  });

  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "available");
  assert.equal(current.receipt.lifecycleBoundary, "session_start");
  assert.equal(current.head.receiptOffset, 0);
});

test("one compact sidecar tails current receipt without repeated evidence arrays", async () => {
  const f = await fixture();
  const result = await materialize(f, [entry("u", "user", "x")]);
  const content = await readFile(result.record.path, "utf8");
  assert.equal(content.split("\n").filter(Boolean).length, 2);
  assert.equal(content.includes("entryIds"), false);
  assert.equal(content.includes("occurrences"), false);
  assert.equal(content.includes("payloads"), false);
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.receipt.sessionId, "s");
  assert.equal(current.head.receiptOffset, 0);
  assert.equal(current.diagnostics.tornTail, false);
  assert.ok(
    current.artifactState,
    "canonical current reader always composes native/artifact state",
  );
});
test("Title derivations share the Session file and repeat the current Summary head", async () => {
  const f = await fixture();
  const branch = [entry("u", "user", "title this")];
  await materialize(f, branch);
  await processRarebitTitle(
    {
      sessionManager: {
        getHeader: () => ({ id: "s" }),
        getSessionFile: () => f.sessionFile,
        getBranch: () => branch,
      },
    },
    {
      sessionRoot: f.sessionRoot,
      rarebitRoot: f.rarebitRoot,
      sourceEntryId: "u",
      titleDate: "2026-07-26",
      model: { provider: "test", id: "model" },
      modelClient: { complete: async () => ({ text: "Compact protocol" }) },
    },
  );
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.receipt.type, "rarebit_summary");
  const history = await readRarebitHistory({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.deepEqual(
    history.records.map(({ record }) => record.type),
    ["rarebit_summary", "rarebit_title"],
  );
});

test("bounded tail works after over 5MiB of prior history and history resumes by offset", async () => {
  const f = await fixture();
  const result = await materialize(f, [entry("u", "user", "x")]);
  await appendFile(result.record.path, " ".repeat(5 * 1024 * 1024) + "\n");
  // A later compact receipt/head is the normal current entrypoint.
  const second = await materialize(f, [entry("u2", "user", "y")], "s2");
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.receipt.sessionId, "s2");
  const history = await readRarebitHistory({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    limit: 1,
  });
  assert.equal(history.records.length, 1);
  assert.ok(history.nextOffset);
});
test("history resumes on exact byte offsets and skips a partial multibyte record", async () => {
  const f = await fixture();
  await materialize(f, [entry("u1", "user", "one")]);
  await materialize(f, [entry("u😀", "user", "two")]);
  await materialize(f, [entry("u3", "user", "three")]);
  const all = await readRarebitHistory({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    limit: 10,
  });
  assert.equal(all.records.length, 3);
  const bytes = await readFile(all.path);
  const emojiOffset = bytes.indexOf(Buffer.from("😀"), all.records[1].offset);
  assert.ok(emojiOffset > all.records[1].offset);
  const resumed = await readRarebitHistory({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    fromOffset: emojiOffset + 1,
    limit: 1,
  });
  assert.equal(resumed.records.length, 1);
  assert.equal(resumed.records[0].offset, all.records[2].offset);
});

test("oversized receipts fail before any sidecar byte is written", async () => {
  const f = await fixture();
  const branch = [entry("u", "user", "x")];
  await writeFile(
    f.sessionFile,
    [
      JSON.stringify({ type: "session", id: "s" }),
      ...branch.map(JSON.stringify),
    ].join("\n") + "\n",
  );
  const reservation = await reserveRarebitJob({
    jobId: "f".repeat(64),
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  await assert.rejects(
    settleRarebitJob(reservation, {
      ...compactReceipt(branch),
      summary: "x".repeat(50 * 1024),
    }),
    /exceeds protocol byte limit/,
  );
  await releaseRarebitJob(reservation);
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "missing");
});

test("compact exact and owner-request prefix applicability re-derives native manifest and anchor", () => {
  const native = selectRarebits([
    entry("u", "user", "one"),
    entry("a", "assistant", "done"),
    entry("u2", "user", "two"),
  ]);
  const prefix = selectRarebits([entry("u", "user", "one")]);
  const ref = {
    manifestHash: prefix.manifestHash,
    selectorVersion: prefix.manifest.selectorVersion,
    occurrenceCount: 1,
    uniquePayloadCount: 1,
    latestUserSourceEntryId: "u",
  };
  assert.equal(requestPrefixApplies(ref, native), false); // a later owner request supersedes it
  const current = selectRarebits([
    entry("u", "user", "one"),
    entry("a", "assistant", "done"),
  ]);
  assert.equal(requestPrefixApplies(ref, current), true);
  const exact = {
    ...ref,
    manifestHash: current.manifestHash,
    occurrenceCount: current.occurrences.length,
  };
  assert.equal(exactSelectionApplies(exact, current), true);
});
test("generated successful and terminal failure receipts satisfy runtime and JSON Schema closure", async () => {
  const f = await fixture();
  const success = await materialize(f, [entry("u", "user", "x")]);
  const broken = await fixture("failure");
  const failure = await processRarebitSummary(
    {
      sessionManager: {
        getHeader: () => ({ id: "failure" }),
        getSessionFile: () => broken.sessionFile,
        getBranch: () => [entry("u", "user", "x")],
      },
    },
    {
      sessionRoot: broken.sessionRoot,
      rarebitRoot: broken.rarebitRoot,
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
      model: { provider: "test", id: "model" },
      modelClient: { complete: async () => "not JSON" },
    },
  );
  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/rarebit.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const persisted of [success.record, failure.record]) {
    const { path, ...record } = persisted;
    assert.equal(validateRarebitArtifactReceipt(record).valid, true);
    assert.equal(validate(record), true, JSON.stringify(validate.errors));
  }
  const validSuccess = structuredClone(success.record);
  delete validSuccess.path;
  const invalid = [
    { ...validSuccess, unexpected: true },
    { ...validSuccess, branch: { ...validSuccess.branch, pathHash: "bad" } },
    {
      ...validSuccess,
      selection: { ...validSuccess.selection, occurrences: [] },
    },
    { ...validSuccess, status: "failure" },
    { ...validSuccess, schemaVersion: 999 },
  ];
  for (const record of invalid) {
    assert.equal(validateRarebitArtifactReceipt(record).valid, false);
    assert.equal(validate(record), false);
  }
});
test("a delayed receipt stays history but cannot advance the head after native evidence changes under the fence", async () => {
  const f = await fixture();
  const oldBranch = [entry("u", "user", "old")];
  const currentBranch = [...oldBranch, entry("u2", "user", "new")];
  await materialize(f, oldBranch, "s", {
    storeHooks: {
      afterLeaseValidated: async () => {
        await writeFile(
          f.sessionFile,
          [
            JSON.stringify({ type: "session", id: "s" }),
            ...currentBranch.map(JSON.stringify),
          ].join("\n") + "\n",
        );
      },
    },
  });
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "missing");
  const history = await readRarebitHistory({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(history.records.length, 1);
});
test("expired-lease reclaim fences the old worker without deleting the new lease", async () => {
  const f = await fixture();
  const branch = [entry("u", "user", "x")];
  await writeFile(
    f.sessionFile,
    [
      JSON.stringify({ type: "session", id: "s" }),
      ...branch.map(JSON.stringify),
    ].join("\n") + "\n",
  );
  const jobId = "d".repeat(64);
  const common = {
    jobId,
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    leaseMs: 1,
  };
  const oldLease = await reserveRarebitJob({ ...common, now: 0 });
  const newLease = await reserveRarebitJob({ ...common, now: 10 });
  assert.equal(newLease.acquired, true);
  assert.notEqual(oldLease.leaseToken, newLease.leaseToken);
  await assert.rejects(
    settleRarebitJob(oldLease, compactReceipt(branch)),
    /fenced by a newer worker/,
  );
  await settleRarebitJob(newLease, compactReceipt(branch));
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.head.receiptHash.length, 64);
  assert.equal(current.receipt.jobId, jobId);
});

test("stale reclaim waits behind settlement's final token check and append", async () => {
  const f = await fixture();
  const branch = [entry("u", "user", "x")];
  await writeFile(
    f.sessionFile,
    [
      JSON.stringify({ type: "session", id: "s" }),
      ...branch.map(JSON.stringify),
    ].join("\n") + "\n",
  );
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const jobId = "c".repeat(64);
  const common = {
    jobId,
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
    leaseMs: 1,
  };
  const first = await reserveRarebitJob({
    ...common,
    now: 0,
    hooks: {
      afterLeaseValidated: async () => {
        enter();
        await barrier;
      },
    },
  });
  const settling = settleRarebitJob(first, compactReceipt(branch));
  await entered;
  let reclaimResolved = false;
  const reclaiming = reserveRarebitJob({ ...common, now: 10 }).then((value) => {
    reclaimResolved = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(reclaimResolved, false);
  release();
  await settling;
  const reclaimed = await reclaiming;
  assert.equal(reclaimed.acquired, false);
  assert.equal(reclaimed.duplicate, true);
});

test("torn head recovers prior complete head but a complete corrupt head fails closed", async () => {
  const f = await fixture();
  const result = await materialize(f, [entry("u", "user", "x")]);
  await appendFile(result.record.path, '{"type":"rarebit_head"');
  let current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "available");
  assert.equal(current.diagnostics.tornTail, true);
  await appendFile(
    result.record.path,
    '\n{"type":"rarebit_head","protocolVersion":1,"sessionId":"s","receiptOffset":999999,"receiptLength":2,"receiptHash":"' +
      "a".repeat(64) +
      '"}\n',
  );
  current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "unreadable");
  assert.equal(current.diagnostics.reason, "sidecar_head_invalid");
});
test("a complete final version-invalid head cannot fall back to a prior valid head", async () => {
  const f = await fixture();
  const result = await materialize(f, [entry("u", "user", "x")]);
  await appendFile(
    result.record.path,
    '{"type":"rarebit_head","protocolVersion":999}\n',
  );
  const current = await readRarebitCurrent({
    sessionFile: f.sessionFile,
    sessionRoot: f.sessionRoot,
    rarebitRoot: f.rarebitRoot,
  });
  assert.equal(current.availability, "unreadable");
  assert.equal(current.receipt, null);
  assert.equal(current.diagnostics.reason, "sidecar_head_invalid");
});
