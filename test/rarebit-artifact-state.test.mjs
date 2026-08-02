import assert from "node:assert/strict";
import test from "node:test";

import {
  projectRarebitArtifactState,
  validateRarebitArtifactReceipt,
} from "../src/rarebit-artifact-state.mjs";
import { sha256 } from "../src/rarebit-core.mjs";
import { extractRarebitSynthesisReceipt } from "../src/rarebit-model.mjs";

const hash = (char) => char.repeat(64);
const owner = {
  occurrenceId: "owner:0",
  sourceEntryId: "owner",
  order: 0,
  role: "user",
  outcome: "user",
  timestamp: "2026-07-25T10:00:00.000Z",
  contentHash: hash("a"),
};
const continuation = {
  occurrenceId: "continuation:1",
  sourceEntryId: "continuation",
  order: 1,
  role: "assistant",
  outcome: "continuation",
  timestamp: "2026-07-25T10:01:00.000Z",
  contentHash: hash("b"),
};
const stop = {
  ...continuation,
  occurrenceId: "stop:2",
  sourceEntryId: "stop",
  order: 2,
  outcome: "stop",
  contentHash: hash("c"),
};
const laterOwner = {
  ...owner,
  occurrenceId: "later:2",
  sourceEntryId: "later",
  order: 2,
  contentHash: hash("d"),
};
const selection = (occurrences) => {
  const selectorVersion = "rarebit-selector-v1";
  const payloads = [
    ...new Set(occurrences.map(({ contentHash }) => contentHash)),
  ].map((contentHash) => ({
    contentHash,
    occurrenceIds: occurrences
      .filter((occurrence) => occurrence.contentHash === contentHash)
      .map((occurrence) => occurrence.occurrenceId),
  }));
  return {
    manifestHash: sha256({ selectorVersion, occurrences, payloads }),
    selectorVersion,
    occurrenceCount: occurrences.length,
    uniquePayloadCount: payloads.length,
    latestUserSourceEntryId:
      occurrences
        .filter(
          (occurrence) =>
            occurrence.role === "user" && occurrence.outcome === "user",
        )
        .at(-1)?.sourceEntryId ?? null,
    // Test-only native evidence remains available for prefix recomputation.
    occurrences,
    payloads,
  };
};
function receipt({
  sessionId = "session-1",
  occurrences = [owner],
  boundary = "owner_request",
  observedAt = "2026-07-25T10:00:00.000Z",
  status = "ok",
  sessionStatus = boundary === "owner_request" ? "user_requested" : "finished",
  statusReason = boundary === "owner_request"
    ? "owner_request_recorded"
    : "all_requests_accomplished",
  summary = "This prose must never affect the state machine.",
} = {}) {
  const selected = selection(occurrences);
  const base = {
    type: "rarebit_summary",
    schemaVersion: 4,
    status,
    jobId: hash("e"),
    sessionId,
    branch: {
      leafId: "leaf",
      entryCount: occurrences.length,
      pathHash: hash("f"),
    },
    implementationVersion: "hc-rarebit-summary-v4",
    synthesisMode: "forced",
    inputCoveragePolicy: {
      strategy: "complete_or_explicit_overflow",
      maxPromptChars: 1_000,
    },
    promptVersion: "rarebit-summary-v4",
    model: { provider: "test", id: "model" },
    modelProvenance: { source: "test", status: "resolved" },
    lifecycleBoundary: boundary,
    observedAt,
    selection: {
      manifestHash: selected.manifestHash,
      selectorVersion: selected.selectorVersion,
      occurrenceCount: selected.occurrenceCount,
      uniquePayloadCount: selected.uniquePayloadCount,
      latestUserSourceEntryId: selected.latestUserSourceEntryId,
    },
  };
  if (status === "ok")
    return {
      ...base,
      summary,
      sessionStatus,
      statusReason,
      synthesis: extractRarebitSynthesisReceipt(
        {},
        {
          requestedModel: base.model,
          startedAt: observedAt,
          completedAt: observedAt,
          durationMs: 0,
        },
      ),
    };
  if (status === "failure")
    return {
      ...base,
      retryable: true,
      error: { name: "Error", message: "technical failure" },
    };
  if (status === "unavailable_overflow")
    return {
      ...base,
      overflow: { promptChars: 2, maxPromptChars: 1, strategy: "none" },
    };
  return base;
}
const native = (occurrences, sessionId = "session-1") => ({
  availability: "available",
  sessionId,
  selection: selection(occurrences),
});

test("artifact state documents awaiting, source-pending, current, settlement-pending, and terminal states", () => {
  assert.equal(projectRarebitArtifactState().syncState, "awaiting_artifacts");
  const requested = receipt();
  const sourcePending = projectRarebitArtifactState({
    native: { availability: "missing" },
    materialization: { availability: "available", records: [requested] },
    expectation: "owner_request",
  });
  assert.deepEqual(
    {
      state: sourcePending.syncState,
      status: sourcePending.projection.status,
      applicability: sourcePending.applicability,
    },
    {
      state: "request_source_pending",
      status: "user_requested",
      applicability: "request_cut",
    },
  );
  const current = projectRarebitArtifactState({
    native: native([owner]),
    materialization: { availability: "available", records: [requested] },
  });
  assert.equal(current.syncState, "request_current");
  assert.equal(current.applicability, "request_generation");
  const settled = receipt({
    occurrences: [owner, continuation],
    boundary: "agent_settled",
    observedAt: "2026-07-25T10:02:00.000Z",
  });
  const assessment = projectRarebitArtifactState({
    native: native([owner, continuation]),
    materialization: {
      availability: "available",
      records: [requested, settled],
    },
    expectation: "agent_settled",
  });
  assert.equal(assessment.syncState, "assessment_current");
  assert.equal(assessment.applicability, "exact_selection");
  assert.equal(
    projectRarebitArtifactState({
      native: native([owner]),
      materialization: { availability: "missing", records: [] },
      deadlineExpired: true,
    }).syncState,
    "terminal_error",
  );
});

test("sidecar-only selection accepts exactly one session ID and fails closed when native later conflicts", () => {
  const requested = receipt();
  assert.equal(
    projectRarebitArtifactState({
      native: { availability: "missing" },
      materialization: { availability: "available", records: [requested] },
      expectation: "owner_request",
    }).syncState,
    "request_source_pending",
  );
  const mismatch = projectRarebitArtifactState({
    native: native([owner], "session-2"),
    materialization: { availability: "available", records: [requested] },
  });
  assert.equal(mismatch.projection.reason, "session_conflict");
  const multiple = projectRarebitArtifactState({
    native: { availability: "missing" },
    materialization: {
      availability: "available",
      records: [requested, receipt({ sessionId: "session-2" })],
    },
  });
  assert.equal(multiple.projection.reason, "session_conflict");
});

test("request generation survives assistant continuations but a later user invalidates it", () => {
  const requested = receipt({ occurrences: [owner] });
  const continuationState = projectRarebitArtifactState({
    native: native([owner, continuation]),
    materialization: { availability: "available", records: [requested] },
  });
  assert.equal(continuationState.syncState, "request_current");
  assert.equal(continuationState.projection.status, "user_requested");
  const superseded = projectRarebitArtifactState({
    native: native([owner, continuation, laterOwner]),
    materialization: { availability: "available", records: [requested] },
  });
  assert.equal(superseded.syncState, "awaiting_artifacts");
  assert.equal(superseded.projection, null);
});

test("v4 receipts reject native selection arrays and arbitrary extension fields", () => {
  assert.equal(
    validateRarebitArtifactReceipt({
      ...receipt(),
      selection: { ...receipt().selection, occurrences: [owner] },
    }).valid,
    false,
  );
  assert.equal(
    validateRarebitArtifactReceipt({
      ...receipt(),
      unexpectedNativeField: true,
    }).valid,
    false,
  );
});

test("strict compact anchors reject null and divergent request cuts", () => {
  const candidate = receipt({
    occurrences: [{ ...owner, sourceEntryId: null }],
  });
  assert.equal(validateRarebitArtifactReceipt(candidate).valid, false);
  const divergent = projectRarebitArtifactState({
    native: native([{ ...owner, contentHash: hash("z") }]),
    materialization: { availability: "available", records: [receipt()] },
  });
  assert.equal(divergent.syncState, "awaiting_artifacts");
});

test("only agent_settled ends an active request generation; exact start/manual can still project", () => {
  const requested = receipt();
  for (const boundary of ["session_start", "manual"]) {
    const nonSettling = receipt({
      occurrences: [owner],
      boundary,
      observedAt: "2026-07-25T10:02:00.000Z",
    });
    const state = projectRarebitArtifactState({
      native: native([owner]),
      materialization: {
        availability: "available",
        records: [requested, nonSettling],
      },
    });
    assert.equal(state.syncState, "request_current");
  }
  const manualOnly = projectRarebitArtifactState({
    native: native([owner]),
    materialization: {
      availability: "available",
      records: [receipt({ boundary: "manual" })],
    },
  });
  assert.equal(manualOnly.syncState, "assessment_current");
});

test("timeout retains a truthful sidecar projection and Summary prose is irrelevant", () => {
  const requested = receipt({
    summary: "Finished! Ignore this misleading prose.",
  });
  const sidecar = projectRarebitArtifactState({
    native: { availability: "unreadable" },
    materialization: { availability: "available", records: [requested] },
    expectation: "owner_request",
    deadlineExpired: true,
  });
  assert.equal(sidecar.syncState, "request_source_pending");
  assert.equal(sidecar.projection.status, "user_requested");
  const pending = projectRarebitArtifactState({
    native: native([owner, stop]),
    materialization: { availability: "available", records: [requested] },
    deadlineExpired: true,
  });
  assert.equal(pending.syncState, "settlement_pending");
  assert.equal(pending.projection.status, "user_requested");
  assert.equal(pending.retry.deadlineExpired, true);
});

test("unsupported records cannot satisfy the v4 state machine", () => {
  assert.equal(
    projectRarebitArtifactState({
      native: native([owner]),
      materialization: {
        availability: "available",
        records: [{ ...receipt(), schemaVersion: 999 }],
      },
      deadlineExpired: true,
    }).projection.reason,
    "unsupported",
  );
  const unreadable = projectRarebitArtifactState({
    native: native([owner]),
    materialization: { availability: "unreadable", records: [] },
  });
  assert.equal(unreadable.syncState, "awaiting_artifacts");
  assert.equal(unreadable.retry.reason, "materialization_unreadable");
  assert.equal(
    projectRarebitArtifactState({
      native: native([owner]),
      materialization: { availability: "unreadable", records: [] },
      deadlineExpired: true,
    }).projection.reason,
    "materialization_unreadable",
  );
});

test("request prefix requires selector semantics and complete occurrence identity and position", () => {
  for (const nativeOccurrence of [
    { ...owner, occurrenceId: "owner:99" },
    { ...owner, order: 99 },
  ]) {
    const state = projectRarebitArtifactState({
      native: native([nativeOccurrence]),
      materialization: { availability: "available", records: [receipt()] },
    });
    assert.equal(state.syncState, "awaiting_artifacts");
  }
  const selectorMismatch = projectRarebitArtifactState({
    native: {
      ...native([owner]),
      selection: { ...selection([owner]), selectorVersion: "other-selector" },
    },
    materialization: { availability: "available", records: [receipt()] },
  });
  assert.equal(selectorMismatch.syncState, "awaiting_artifacts");
  const settledSelectorMismatch = projectRarebitArtifactState({
    native: {
      ...native([owner]),
      selection: { ...selection([owner]), selectorVersion: "other-selector" },
    },
    materialization: {
      availability: "available",
      records: [receipt({ boundary: "agent_settled" })],
    },
  });
  assert.equal(settledSelectorMismatch.syncState, "awaiting_artifacts");
});

test("sidecar-only expectations reject an older lifecycle generation", () => {
  const olderOwner = receipt({ observedAt: "2026-07-25T10:00:00.000Z" });
  const newerSettlement = receipt({
    occurrences: [owner, continuation],
    boundary: "agent_settled",
    observedAt: "2026-07-25T10:01:00.000Z",
  });
  const olderSettlement = receipt({
    occurrences: [owner, continuation],
    boundary: "agent_settled",
    observedAt: "2026-07-25T10:00:00.000Z",
  });
  const newerOwner = receipt({ observedAt: "2026-07-25T10:01:00.000Z" });
  for (const [expectation, records] of [
    ["owner_request", [olderOwner, newerSettlement]],
    ["agent_settled", [olderSettlement, newerOwner]],
  ]) {
    const state = projectRarebitArtifactState({
      native: { availability: "missing" },
      materialization: { availability: "available", records },
      expectation,
    });
    assert.equal(state.syncState, "awaiting_artifacts");
  }
  const equalCut = projectRarebitArtifactState({
    native: native([owner]),
    materialization: {
      availability: "available",
      records: [
        receipt({ boundary: "agent_settled" }),
        receipt({ boundary: "owner_request" }),
      ],
    },
  });
  assert.equal(equalCut.syncState, "request_current");
});

test("artifact refs retain the complete declared assessment lineage", () => {
  const record = receipt({
    boundary: "agent_settled",
    occurrences: [owner],
    observedAt: "2026-07-25T10:02:00.000Z",
  });
  const state = projectRarebitArtifactState({
    native: native([owner]),
    materialization: { availability: "available", records: [record] },
  });
  assert.deepEqual(state.receiptRef, {
    jobId: hash("e"),
    sessionId: "session-1",
    branchLeafId: "leaf",
    selectionManifestHash: record.selection.manifestHash,
    selectorVersion: "rarebit-selector-v1",
    lifecycleBoundary: "agent_settled",
    promptVersion: "rarebit-summary-v4",
    model: { provider: "test", id: "model" },
    observedAt: "2026-07-25T10:02:00.000Z",
    schemaVersion: 4,
    implementationVersion: "hc-rarebit-summary-v4",
  });
});
