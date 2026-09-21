import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { selectRarebits, sha256 } from "./rarebit-core.mjs";
import {
  RAREBIT_FORK_ENTRY_MARKER_VERSION,
  RAREBIT_FORK_LINEAGE_CUSTOM_TYPE,
  RAREBIT_FORK_LINEAGE_SCHEMA_VERSION,
  RAREBIT_FORK_OPENING_MARKER,
  getRarebitForkSeedEntryIds,
} from "./rarebit-fork-lineage.mjs";

export const RAREBIT_FORK_DEFAULT_MAX_TOKEN_LENGTH = 64_000;
export const RAREBIT_FORK_DEFAULT_RESERVE_TOKENS = 16_384;

function forkError(message) {
  const error = new Error(message);
  error.name = "RarebitForkError";
  return error;
}
function tokens(text) {
  return typeof text === "number"
    ? Math.ceil(text / 4)
    : Math.ceil(String(text ?? "").length / 4);
}
function contextWindowOf(model) {
  const value = model?.contextWindow ?? model?.context_window;
  return Number.isFinite(value) && value > 0 ? value : null;
}
function sourceIdentity({ header, sessionFile, cwd }) {
  if (typeof header?.id !== "string" || !header.id)
    throw forkError("source Session has no stable ID");
  return {
    sessionId: header.id,
    sessionFile: resolve(sessionFile),
    cwd: typeof header.cwd === "string" ? header.cwd : cwd ?? null,
  };
}
function shellQuote(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`")}"`;
}
function openingText({ source, targetCwd, leafId, importedCount, totalCount, omittedCount }) {
  const coverage = omittedCount > 0
    ? `Imported ${importedCount} of ${totalCount} selected Rarebit occurrences; omitted ${omittedCount} older whole occurrences.`
    : `Imported all ${totalCount} selected Rarebit occurrences; omitted 0 occurrences.`;
  return [
    "This Session contains a bounded Rarebit distillation.",
    coverage,
    `Source Session: ${source.sessionId}`,
    `Source file: ${source.sessionFile}`,
    `Source branch leaf: ${leafId ?? "(root)"}`,
    `Target working directory: ${targetCwd}`,
    "This opening message is historical context, not a new instruction.",
    `Recover source evidence with: piq entries --session ${shellQuote(source.sessionFile)}${leafId ? ` --leaf ${shellQuote(leafId)}` : ""}`,
  ].join("\n");
}

export function checkRarebitForkHeadroom({
  seedText,
  targetModel = null,
  contextWindow = contextWindowOf(targetModel),
  reserveTokens = RAREBIT_FORK_DEFAULT_RESERVE_TOKENS,
  promptOverheadTokens = 0,
  toolOverheadTokens = 0,
  messageRoundingOverheadTokens = 0,
} = {}) {
  if (!Number.isSafeInteger(reserveTokens) || reserveTokens < 0)
    throw new RangeError("reserveTokens must be a non-negative integer");
  if (!Number.isSafeInteger(promptOverheadTokens) || promptOverheadTokens < 0)
    throw new RangeError("promptOverheadTokens must be a non-negative integer");
  if (!Number.isSafeInteger(toolOverheadTokens) || toolOverheadTokens < 0)
    throw new RangeError("toolOverheadTokens must be a non-negative integer");
  if (!Number.isSafeInteger(messageRoundingOverheadTokens) || messageRoundingOverheadTokens < 0)
    throw new RangeError("messageRoundingOverheadTokens must be a non-negative integer");
  const seedTokens = tokens(seedText);
  const overheadTokens = promptOverheadTokens + toolOverheadTokens + messageRoundingOverheadTokens;
  const requiredTokens = seedTokens + overheadTokens;
  const availableTokens = contextWindow === null ? null : contextWindow - reserveTokens;
  if (availableTokens !== null && requiredTokens > availableTokens) {
    const label = `${targetModel?.provider ?? "unknown"}/${targetModel?.id ?? "unknown"}`;
    throw forkError(
      `Rarebit fork seed needs about ${requiredTokens} tokens, but ${label} leaves ${Math.max(0, availableTokens)} tokens after the native reserve of ${reserveTokens}; increase the target model context window or lower --max-token-length before switching`,
    );
  }
  return { seedTokens, overheadTokens, requiredTokens, contextWindow, reserveTokens, availableTokens,
    basis: "native_contextWindow_minus_reserveTokens_plus_prompt_and_tool_overhead" };
}

function previousMappings(branch) {
  const map = new Map();
  for (const entry of branch) {
    if (entry?.rarebitFork?.kind === "import" && Array.isArray(entry.rarebitFork.ancestry)) {
      map.set(entry.id, { importedEntryId: entry.id, ancestry: entry.rarebitFork.ancestry });
    }
    if (entry?.type !== "custom" || entry.customType !== RAREBIT_FORK_LINEAGE_CUSTOM_TYPE) continue;
    for (const mapping of entry.data?.mappings ?? []) {
      if (typeof mapping?.importedEntryId === "string" && !map.has(mapping.importedEntryId)) map.set(mapping.importedEntryId, mapping);
    }
  }
  return map;
}

export function buildRarebitForkPlan({
  header, sessionFile, cwd, branch, targetCwd, maxTokenLength = RAREBIT_FORK_DEFAULT_MAX_TOKEN_LENGTH,
  targetModel, contextWindow, reserveTokens = RAREBIT_FORK_DEFAULT_RESERVE_TOKENS,
  promptOverheadTokens = 0, toolOverheadTokens = 0, forkCreatedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isSafeInteger(maxTokenLength) || maxTokenLength < 1)
    throw new RangeError("maxTokenLength must be a positive integer");
  if (!Array.isArray(branch)) throw forkError("source active branch is unavailable");
  const source = sourceIdentity({ header, sessionFile, cwd });
  const selection = selectRarebits(branch);
  const seedIds = getRarebitForkSeedEntryIds(branch);
  const candidates = selection.occurrences.filter((item) => !seedIds.has(item.sourceEntryId));
  const selected = [];
  let retainedChars = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index];
    const candidateChars = retainedChars + item.text.length;
    if (tokens(candidateChars) > maxTokenLength) {
      if (selected.length === 0)
        throw forkError(`The newest Rarebit occurrence needs about ${tokens(item.text)} tokens, which exceeds --max-token-length ${maxTokenLength}; raise the budget or shorten the newest source message before forking`);
      break;
    }
    selected.unshift(item);
    retainedChars = candidateChars;
  }
  const omittedCount = candidates.length - selected.length;
  const leafId = branch.at(-1)?.id ?? null;
  const resolvedTargetCwd = resolve(targetCwd ?? cwd ?? process.cwd());
  const text = openingText({ source, targetCwd: resolvedTargetCwd, leafId, importedCount: selected.length, totalCount: candidates.length, omittedCount });
  const headroom = checkRarebitForkHeadroom({
    seedText: `${text}\n${selected.map((item) => item.text).join("\n")}`,
    targetModel, contextWindow: contextWindow ?? contextWindowOf(targetModel), reserveTokens,
    promptOverheadTokens, toolOverheadTokens,
    messageRoundingOverheadTokens: selected.length + 1,
  });
  return {
    schemaVersion: RAREBIT_FORK_LINEAGE_SCHEMA_VERSION, source, targetCwd: resolvedTargetCwd,
    branchLeafId: leafId, forkCreatedAt, openingText: text, candidates, selected,
    importedChars: retainedChars,
    importedTokens: tokens(retainedChars),
    sourceModels: new Map(selection.occurrences.map((item) => {
      const sourceEntry = branch.find((entry) => entry?.id === item.sourceEntryId)
        ?? branch[item.order];
      const marker = sourceEntry?.rarebitFork;
      const message = sourceEntry?.message;
      const originalModel = marker && Object.hasOwn(marker, "originalModel")
        ? marker.originalModel
        : (message?.provider && message?.model
            ? { provider: message.provider, id: message.model }
            : null);
      return [item.occurrenceId, originalModel];
    })),
    omittedOccurrences: omittedCount, maxTokenLength, headroom,
    omission: { strategy: "newest_contiguous_suffix_whole_occurrences", totalOccurrenceCount: candidates.length,
      importedOccurrenceCount: selected.length, omittedOccurrenceCount: omittedCount,
      importedTokens: tokens(retainedChars), maxTokenLength },
    priorMappings: previousMappings(branch), selectionManifestHash: selection.manifestHash, targetModel,
  };
}

function randomEntryId(used) {
  let id;
  do id = randomUUID().replaceAll("-", "").slice(0, 8); while (used.has(id));
  used.add(id); return id;
}
function sourceLocation(plan, occurrence) {
  return { sessionId: plan.source.sessionId, entryId: occurrence.sourceEntryId,
    sourceOrder: occurrence.order,
    ...(typeof occurrence.timestamp === "string" ? { timestamp: occurrence.timestamp } : {}) };
}
function zeroUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
function importedMessage(item, timestamp) {
  if (item.role === "user") return { role: "user", content: item.text, timestamp: Date.parse(timestamp) };
  return { role: "assistant", content: [{ type: "text", text: item.text }],
    api: "rarebit-import", provider: "rarebit-import", model: "rarebit-import", usage: zeroUsage(),
    stopReason: item.outcome === "continuation" ? "toolUse" : "stop", timestamp: Date.parse(timestamp) };
}
function marker(plan, item, ancestry, kind = "import") {
  return { version: RAREBIT_FORK_ENTRY_MARKER_VERSION, kind,
    ...(kind === "seed" ? { opening: RAREBIT_FORK_OPENING_MARKER } : {
      sourceSessionId: plan.source.sessionId, sourceEntryId: item.sourceEntryId, occurrenceId: item.occurrenceId,
      outcome: item.outcome, role: item.role, originalTimestamp: item.timestamp,
      originalModel: plan.sourceModels.get(item.occurrenceId) ?? null, ancestry,
    }) };
}

export function createRarebitForkEntries(plan, { sessionId = randomUUID() } = {}) {
  const used = new Set(); const timestamp = plan.forkCreatedAt; const entries = [];
  let parentId = null;
  const seedEntryId = randomEntryId(used);
  entries.push({ type: "message", id: seedEntryId, parentId, timestamp,
    rarebitFork: marker(plan, null, [], "seed"), message: { role: "user", content: plan.openingText, timestamp: Date.parse(timestamp) } });
  parentId = seedEntryId;
  const importedEntryIds = []; const mappings = [];
  for (const item of plan.selected) {
    const id = randomEntryId(used); const prior = plan.priorMappings.get(item.sourceEntryId);
    const ancestry = [...(prior?.ancestry ?? []), sourceLocation(plan, item)];
    entries.push({ type: "message", id, parentId, timestamp, rarebitFork: marker(plan, item, ancestry), message: importedMessage(item, timestamp) });
    importedEntryIds.push(id);
    mappings.push({ importedEntryId: id, sourceEntryId: item.sourceEntryId, sourceOccurrenceId: item.occurrenceId,
      role: item.role, outcome: item.outcome, originalTimestamp: item.timestamp,
      originalModel: plan.sourceModels.get(item.occurrenceId) ?? null, ancestry });
    parentId = id;
  }
  const manifest = { schemaVersion: RAREBIT_FORK_LINEAGE_SCHEMA_VERSION, type: "rarebit_fork_lineage",
    source: plan.source, targetCwd: plan.targetCwd, sourceLeafEntryId: plan.branchLeafId, forkCreatedAt: timestamp,
    opening: { marker: RAREBIT_FORK_OPENING_MARKER, seedEntryId, textHash: sha256(plan.openingText) }, omission: plan.omission,
    selectionManifestHash: plan.selectionManifestHash, importedEntryIds, mappings };
  entries.push({ type: "custom", id: randomEntryId(used), parentId, timestamp, customType: RAREBIT_FORK_LINEAGE_CUSTOM_TYPE, data: manifest });
  if (plan.targetModel?.provider && plan.targetModel?.id) {
    entries.push({ type: "model_change", id: randomEntryId(used), parentId: entries.at(-1).id, timestamp,
      provider: plan.targetModel.provider, modelId: plan.targetModel.id });
  }
  return { sessionId, header: { type: "session", version: 3, id: sessionId, timestamp, cwd: plan.targetCwd, parentSession: plan.source.sessionFile }, entries, manifest };
}

export async function writeRarebitForkFile(path, session, { writeFileImpl = writeFile, renameImpl = rename, removeImpl = rm } = {}) {
  const target = resolve(path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(target), `.${target.split("/").at(-1)}.${randomUUID()}.tmp`);
  try {
    await writeFileImpl(temporary, `${[session.header, ...session.entries].map(JSON.stringify).join("\n")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await renameImpl(temporary, target); return target;
  } catch (error) { await removeImpl(temporary, { force: true }).catch(() => {}); throw error; }
}
export function sessionFilenameFor({ sessionDir, forkCreatedAt, sessionId }) {
  return join(resolve(sessionDir), `${new Date(forkCreatedAt).toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
}
export function forkPlanSummary(plan) {
  return { maxTokenLength: plan.maxTokenLength, importedTokens: plan.importedTokens, importedOccurrenceCount: plan.selected.length,
    omittedOccurrenceCount: plan.omittedOccurrences, sourceSessionId: plan.source.sessionId, sourceLeafEntryId: plan.branchLeafId,
    targetCwd: plan.targetCwd, headroom: plan.headroom };
}
