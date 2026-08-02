import assert from "node:assert/strict";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeRarebitSummarySynthesis,
  selectRarebits,
} from "../src/rarebit-core.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";

const summary =
  "The agent inspected the evidence and needs the owner to decide.";
function branch() {
  return [
    {
      type: "message",
      id: "owner",
      message: { role: "user", content: "Inspect the evidence." },
    },
  ];
}

test("v4 producer records free-form status/reason and owner-request provenance", async () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../schemas/rarebit.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(schema.definitions.summary.properties.sessionStatus);
  assert.ok(schema.definitions.summary.properties.statusReason);
  const root = await mkdtemp(join(tmpdir(), "rarebit-summary-v4-"));
  const sessionRoot = join(root, "sessions");
  const rarebitRoot = join(root, "rarebit");
  const sessionDir = join(sessionRoot, "owner-request");
  const sessionFile = join(sessionDir, "session.jsonl");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionFile, "{}\n");
  const result = await processRarebitSummary(
    {
      sessionManager: {
        getHeader: () => ({ id: "owner-request" }),
        getSessionFile: () => sessionFile,
        getBranch: branch,
      },
    },
    {
      sessionRoot,
      rarebitRoot,
      summaryPolicy: { minTotalLength: 0, maxRarebitRatio: 1 },
      model: { provider: "test", id: "v4" },
      lifecycleBoundary: "owner_request",
      modelClient: {
        complete: async () => ({
          text: JSON.stringify({
            summary,
            sessionStatus: "user_requested",
            statusReason: "owner_request_recorded",
          }),
        }),
      },
    },
  );
  assert.equal(result.record.status, "ok");
  assert.equal(result.record.schemaVersion, 4);
  assert.equal(result.record.sessionStatus, "user_requested");
  assert.equal(result.record.statusReason, "owner_request_recorded");
  assert.equal(result.record.lifecycleBoundary, "owner_request");
  const persisted = (await readFile(result.record.path, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .find((record) => record.type === "rarebit_summary");
  assert.equal(persisted.sessionStatus, "user_requested");
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate(persisted), true, JSON.stringify(validate.errors));
  const unsupportedReceipt = { ...persisted, schemaVersion: 999 };
  assert.equal(validate(unsupportedReceipt), false);
  const missingV4Boundary = { ...persisted };
  delete missingV4Boundary.lifecycleBoundary;
  assert.equal(validate(missingV4Boundary), false);
  const illegalNeedReason = {
    ...persisted,
    lifecycleBoundary: "agent_settled",
    sessionStatus: "needs_attention",
    statusReason: "all_requests_accomplished",
  };
  assert.equal(validate(illegalNeedReason), false);
  const illegalOwnerBoundary = {
    ...persisted,
    sessionStatus: "finished",
    statusReason: "all_requests_accomplished",
  };
  assert.equal(validate(illegalOwnerBoundary), false);
});

test("v4 synthesis validates legal status/reason combinations without rigid sections", () => {
  assert.deepEqual(
    normalizeRarebitSummarySynthesis(
      JSON.stringify({
        summary: "Any free-form prose\nwith controls\u0000 removed",
        sessionStatus: "needs_attention",
        statusReason: "unfinished",
      }),
    ),
    {
      summary: "Any free-form prose with controls removed",
      sessionStatus: "needs_attention",
      statusReason: "unfinished",
    },
  );
  assert.throws(
    () =>
      normalizeRarebitSummarySynthesis(
        JSON.stringify({
          summary,
          sessionStatus: "finished",
          statusReason: "unfinished",
        }),
      ),
    /illegal statusReason/,
  );
  assert.throws(
    () => normalizeRarebitSummarySynthesis(JSON.stringify({ summary })),
    /sessionStatus/,
  );
});

test("settled prompt makes completion and unfinished judgments only from visible Rarebit prose", async () => {
  const selection = selectRarebits(branch());
  const { composeRarebitSummaryPrompt } =
    await import("../src/rarebit-core.mjs");
  const prompt = composeRarebitSummaryPrompt(selection, {
    lifecycleBoundary: "agent_settled",
  });
  assert.match(prompt, /every active, non-superseded request/i);
  assert.match(
    prompt,
    /cancellation, replacement, supersession, and later resolution/i,
  );
  assert.match(prompt, /Tool-call inputs, tool results.*deliberately absent/i);
  assert.match(
    prompt,
    /Absence of a tool transcript.*never.*work was not performed/i,
  );
  assert.match(prompt, /concise 'done'.*appear accomplished/i);
  assert.match(prompt, /I will run tests next/i);
  assert.match(prompt, /unfinished.*explicit\/positive selected evidence/i);
  assert.match(prompt, /finished\/all_requests_accomplished/i);
  assert.match(
    prompt,
    /finished is only the scoped appearance-based Session-requests assessment/i,
  );
  assert.doesNotMatch(prompt, /"finished\|needs_attention"/);
  const ownerRequestPrompt = composeRarebitSummaryPrompt(selection, {
    lifecycleBoundary: "owner_request",
  });
  assert.match(
    ownerRequestPrompt,
    /newly persisted role:user message/i,
  );
  assert.match(ownerRequestPrompt, /change it makes to active requests/i);
  assert.match(ownerRequestPrompt, /does not verify producer or human identity/i);
  assert.match(ownerRequestPrompt, /Tool-call inputs, tool results/i);
  assert.match(
    ownerRequestPrompt,
    /Always use that status pair at this boundary/i,
  );
});
