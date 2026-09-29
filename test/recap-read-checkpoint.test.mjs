import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRarebitRecapController } from "../src/rarebit-recap.mjs";
import { recapReadCheckpoint } from "../src/rarebit-read-checkpoint.mjs";
import { selectRarebits, composeRarebitSummaryDerivationInput } from "../src/rarebit-core.mjs";
import { processRarebitSummary } from "../src/rarebit-service.mjs";

test("scrollable Recap persists read coverage across resume without acknowledging later updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "rarebit-read-test-"));
  try {
    const manager = SessionManager.create(root, root);
    manager.appendMessage({ role: "user", content: "Synthetic request: repair the renderer", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Renderer repaired. Approval still required." }],
      stopReason: "stop", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const selection = selectRarebits(manager.getBranch());
    const receipt = { status: "ok", jobId: "synthetic-recap", sessionId: manager.getHeader().id,
      selection: { manifestHash: selection.manifestHash, selectorVersion: selection.manifest.selectorVersion },
      sessionStatus: "needs_attention", observedAt: new Date(0).toISOString(), summary: "Renderer repaired; approval needed." };
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
    assert.match(component.render(80).join("\n"), /got it/);
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
