import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { selectRarebits } from "../src/rarebit-core.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";
import {
  parseNativeSession,
  queryRarebits,
  resolveActiveBranch,
} from "../src/rarebit-session.mjs";

const corpus = JSON.parse(
  await readFile(
    new URL("./fixtures/conformance-corpus.v1.json", import.meta.url),
    "utf8",
  ),
);

const jsonl = (records) => `${records.map(JSON.stringify).join("\n")}\n`;
const comparable = (occurrence) => ({
  sourceEntryId: occurrence.sourceEntryId,
  role: occurrence.role,
  outcome: occurrence.outcome,
  text: occurrence.text,
});

test("human-reviewed Rarebit corpus names strict and adjacent consumer capabilities", () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.selectorVersion, "rarebit-selector-v1");
  assert.deepEqual(corpus.capabilities.strictRarebit, [
    "core",
    "cli",
    "pi_extension",
  ]);
  assert.match(
    corpus.capabilities.knownNonconformance.timeline,
    /active branch/,
  );
  for (const description of Object.values(
    corpus.capabilities.notRarebitProjections,
  ))
    assert.equal(typeof description, "string");
});

for (const fixture of corpus.cases) {
  test(`strict Rarebit conformance: ${fixture.id}`, () => {
    const parsed = parseNativeSession(jsonl(fixture.records), fixture.id);
    const branch = resolveActiveBranch(parsed, fixture.id);
    assert.deepEqual(
      branch.map((entry) => entry.id),
      fixture.expected.activeBranchIds,
    );
    const selection = selectRarebits(branch);
    assert.equal(
      selection.occurrences.every(
        (occurrence) => !Object.hasOwn(occurrence, "producer"),
      ),
      true,
    );
    assert.deepEqual(
      selection.occurrences.map(comparable),
      fixture.expected.rarebits,
    );
    for (const excluded of fixture.expected.excludedEntryIds)
      assert.equal(
        selection.occurrences.some(
          (occurrence) => occurrence.sourceEntryId === excluded,
        ),
        false,
      );
  });
}

test("CLI query and Pi imperative shell consume the same active-branch selection", async () => {
  const fixture = corpus.cases.find(
    (candidate) => candidate.id === "fork-compaction-and-resume",
  );
  const root = await mkdtemp(join(tmpdir(), "rarebit-conformance-"));
  const path = join(root, "session.jsonl");
  await writeFile(path, jsonl(fixture.records));

  const queried = await queryRarebits(path);
  const expectedIds = fixture.expected.rarebits.map(
    (occurrence) => occurrence.sourceEntryId,
  );
  assert.deepEqual(
    queried.rarebits.map((occurrence) => occurrence.sourceEntryId),
    expectedIds,
  );
  assert.equal(
    queried.rarebits.every(
      (occurrence) => !Object.hasOwn(occurrence, "producer"),
    ),
    true,
  );

  const parsed = parseNativeSession(jsonl(fixture.records), fixture.id);
  const branch = resolveActiveBranch(parsed, fixture.id);
  const piShell = await processRarebitSummary(undefined, {
    branch,
    sessionId: "session-fork",
  });
  assert.equal(piShell.record.status, "skipped_ephemeral_session");
  assert.equal(piShell.record.selection.occurrenceCount, expectedIds.length);
  assert.equal(
    piShell.record.selection.latestUserSourceEntryId,
    queried.rarebits.filter((occurrence) => occurrence.role === "user").at(-1)
      ?.sourceEntryId ?? null,
  );
});

test("strict reader rejects malformed JSONL instead of returning a partial selection", () => {
  const fixture = corpus.failureCases.find(
    (candidate) => candidate.id === "malformed-jsonl",
  );
  assert.equal(fixture.expected.strictStatus, "unavailable");
  assert.throws(
    () => parseNativeSession(`${fixture.lines.join("\n")}\n`, fixture.id),
    /malformed JSON/,
  );
});

test("strict branch resolver rejects missing lineage instead of guessing", () => {
  const fixture = corpus.failureCases.find(
    (candidate) => candidate.id === "missing-active-parent",
  );
  const parsed = parseNativeSession(jsonl(fixture.records), fixture.id);
  assert.equal(fixture.expected.strictStatus, "unavailable");
  assert.throws(
    () => resolveActiveBranch(parsed, fixture.id),
    /missing parent Session entry/,
  );
});

test("capped and absent inputs are declared unavailable capabilities, never empty success", () => {
  for (const id of ["scan-capped", "source-unavailable"]) {
    const fixture = corpus.failureCases.find(
      (candidate) => candidate.id === id,
    );
    assert.deepEqual(Object.keys(fixture.expected).sort(), [
      "reason",
      "strictStatus",
    ]);
    assert.equal(fixture.expected.strictStatus, "unavailable");
    assert.match(fixture.expected.reason, /^(scan_capped|source_unavailable)$/);
  }
});
