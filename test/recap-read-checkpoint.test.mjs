import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createRarebitRecapController } from "../src/rarebit-recap.mjs";
import { recapIsRead, recapReadCheckpoint } from "../src/rarebit-read-checkpoint.mjs";
import { selectRarebits, composeRarebitSummaryDerivationInput, sha256 } from "../src/rarebit-core.mjs";
import { extractRarebitSynthesisReceipt } from "../src/rarebit-model.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";

test("read validation uses native-entry chronology when non-Rarebit records separate occurrences", () => {
  const entries = [
    { id: "u1", type: "message", message: { role: "user", content: "first" } },
    { id: "tool", type: "message", message: { role: "toolResult", content: "ignored" } },
    { id: "u2", type: "message", message: { role: "user", content: "second" } },
  ];
  const selection = selectRarebits(entries);
  const hash = selectRarebits(entries).manifestHash;
  const branch = [...entries,
    { id: "recap", type: "custom", customType: "rarebit-recap", data: { version: 1, jobId: "job", coveredEntryId: "u2", selectionHash: hash } },
    { id: "read", type: "custom", customType: "rarebit-recap-read", data: { version: 1, recapEntryId: "recap", jobId: "job", coveredEntryId: "u2", selectionHash: hash } },
  ];
  assert.equal(recapReadCheckpoint(branch, selection).coveredEntryId, "u2");
});

test("forged and out-of-order read markers do not acknowledge a Recap", () => {
  const evidence = { id: "u", type: "message", message: { role: "user", content: "request" } };
  const selection = selectRarebits([evidence]);
  const recap = { id: "recap", type: "custom", customType: "rarebit-recap", data: {
    version: 1, jobId: "job", coveredEntryId: "u", selectionHash: selection.manifestHash,
  } };
  const invalid = [
    { ...recap, id: "read", customType: "rarebit-recap-read", data: { ...recap.data, recapEntryId: "recap" } },
    evidence,
    recap,
  ];
  assert.equal(recapIsRead(invalid, recap), false);
  assert.equal(recapReadCheckpoint(invalid, selection), null);
});

test("scrollable Recap persists read coverage across resume without acknowledging later updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-read-test-"));
  try {
    const manager = SessionManager.create(root, root);
    manager.appendMessage({ role: "user", content: "Synthetic request: repair the renderer", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Renderer repaired. Approval still required." }],
      stopReason: "stop", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const selection = selectRarebits(manager.getBranch());
    const observedAt = "1970-01-01T00:00:00.000Z";
    const latestUser = selection.occurrences.filter((item) => item.role === "user").at(-1);
    const receipt = {
      schemaVersion: 4, type: "rarebit_summary", status: "ok", jobId: sha256("synthetic-recap"),
      sessionId: manager.getHeader().id,
      branch: { leafId: manager.getBranch().at(-1).id, entryCount: manager.getBranch().length, pathHash: sha256(manager.getBranch().map((item) => item.id)) },
      observedAt, selection: { manifestHash: selection.manifestHash, selectorVersion: selection.manifest.selectorVersion,
        occurrenceCount: selection.occurrences.length, uniquePayloadCount: selection.payloads.length, latestUserSourceEntryId: latestUser.sourceEntryId },
      lifecycleBoundary: "agent_settled", implementationVersion: "hc-rarebit-summary-v7", synthesisMode: "forced",
      inputCoveragePolicy: { strategy: "newest_suffix_with_explicit_omission", maxPromptChars: 10_000 },
      promptVersion: "rarebit-summary-v8", model: { provider: "fixture", id: "summary" },
      modelProvenance: { source: "test", status: "resolved" },
      summary: "Renderer repaired; approval needed.", sessionStatus: "needs_attention", statusReason: "approval",
      inputCoverage: { totalMessageCount: selection.occurrences.length, includedMessageCount: selection.occurrences.length,
        omittedMessageCount: 0, omittedTextChars: 0, promptChars: 100, complete: true },
      synthesis: extractRarebitSynthesisReceipt({}, { requestedModel: { provider: "fixture", id: "summary" },
        startedAt: observedAt, completedAt: observedAt, durationMs: 0 }),
    };
    const widgets = [];
    const ctx = { mode: "tui", ui: { setWidget: (...args) => widgets.push(args) }, sessionManager: manager };
    const controller = createRarebitRecapController({
      appendEntry: (type, data) => manager.appendCustomEntry(type, data),
      readCurrent: async () => ({ receipt, artifactState: { syncState: "assessment_current", applicability: "exact_selection",
        receiptRef: { jobId: receipt.jobId }, projection: { status: receipt.sessionStatus } } }),
    });
    assert.equal((await controller.showExisting(ctx)).shown, true);
    assert.ok(!widgets.some(([, content]) => content), "no pinned recap widget");
    const recap = manager.getBranch().at(-1);
    const component = controller.renderEntry(recap, {}, { fg: (_color, text) => text });
    assert.match(component.render(80).join("\n"), /Renderer repaired; approval needed/);
    const wideRender = component.render(80);
    assert.match(wideRender.join("\n"), /got it/);
    for (const width of [1, 4, 8])
      assert.ok(component.render(width).every((line) => visibleWidth(line) <= width), `Recap rows stay within ${width} columns`);
    manager.appendMessage({ role: "user", content: "Synthetic later update: also fix resize", timestamp: 3 });
    controller.updateContext(ctx);
    assert.equal(controller.acknowledge(ctx).acknowledged, true);
    assert.equal(controller.acknowledge(ctx).reason, "already_read");
    assert.match(component.render(80).join("\n"), /✓ got it/);

    const resumed = SessionManager.open(manager.getSessionFile(), root);
    const branch = resumed.getBranch();
    const loadedSelection = selectRarebits(branch);
    const checkpoint = recapReadCheckpoint(branch, loadedSelection);
    assert.equal(checkpoint.coveredEntryId, selection.occurrences.at(-1).sourceEntryId);
    const input = composeRarebitSummaryDerivationInput(loadedSelection, { readCheckpoint: checkpoint });
    const lines = input.prompt.split("BEGIN_RAREBIT_MESSAGES_JSONL\n")[1].split("\nEND_RAREBIT_MESSAGES_JSONL")[0].split("\n").map(JSON.parse);
    assert.equal(lines.findIndex((line) => line.type === "recap_read"), 2);
    assert.match(lines[3].text, /also fix resize/);
    assert.match(input.prompt, /Acknowledgement does not resolve requests/);
    assert.match(input.prompt, /at most 300 characters/);
    assert.equal(loadedSelection.occurrences.length, 3, "UI state stays out of conversation prose");

    let providerPrompt;
    const result = await processRarebitSummary({ sessionManager: resumed }, {
      sessionRoot: root, rarebitRoot: join(root, "receipts"), forceSynthesis: true,
      model: { provider: "fixture", id: "fixture" },
      modelClient: { complete: async ({ prompt }) => {
        providerPrompt = prompt;
        return JSON.stringify({ summary: "Resize repair newly requested; renderer approval remains open.", sessionStatus: "needs_attention", statusReason: "approval" });
      } },
    });
    assert.equal(result.record.status, "ok");
    assert.match(providerPrompt, /"type":"recap_read"/);
    assert.ok(result.record.summary.length <= 300);

    // Navigating away from the read marker and into a sibling branch must not
    // carry the checkpoint from a different conversation path.
    resumed.branch(selection.occurrences.at(-1).sourceEntryId);
    resumed.appendMessage({ role: "user", content: "Synthetic sibling update", timestamp: 4 });
    assert.equal(recapReadCheckpoint(resumed.getBranch(), selectRarebits(resumed.getBranch())), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
