import {
  listSessionBranches,
  readPiSession,
  resolveSessionBranch,
} from "./pi-session.mjs";

export const PIQ_SCHEMA_VERSION = 1;
const FROM_FLAG = "--from";

function piqError(message) {
  const error = new Error(message);
  error.name = "PiQError";
  return error;
}

function normalizeDate(value, flag) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw piqError(`${flag} requires an ISO-8601 timestamp`);
  return Date.parse(value);
}

function timestampOf(entry) {
  return typeof entry?.timestamp === "string" ? entry.timestamp : null;
}

function inDateRange(entry, from, to) {
  const timestamp = timestampOf(entry);
  if (from === null && to === null) return true;
  if (!timestamp) return false;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  return (from === null || value >= from) && (to === null || value <= to);
}

function roleMatches(entry, role) {
  if (!role) return true;
  const actual = entry?.message?.role;
  return role === "tool" ? actual === "toolResult" : actual === role;
}

function entryRecord(entry, order, sessionId, leafId) {
  // Keep the native object intact. The _piq envelope adds coordinates without
  // interpreting or dropping fields from newer Pi versions.
  return {
    entry,
    _piq: {
      schemaVersion: PIQ_SCHEMA_VERSION,
      kind: "entry",
      sessionId,
      branchLeafId: leafId,
      branchOrder: order,
    },
  };
}

function toolRecords(branch, sessionId, leafId, mode) {
  const records = [];
  for (let order = 0; order < branch.length; order += 1) {
    const entry = branch[order];
    const messageRole = entry?.message?.role;
    if (mode !== "tool-results" && messageRole === "assistant") {
      const content = Array.isArray(entry?.message?.content)
        ? entry.message.content
        : [];
      for (const [blockIndex, tool] of content.entries()) {
        if (!tool || typeof tool !== "object") continue;
        if (tool.type !== "toolCall" && tool.type !== "tool_call") continue;
        records.push({
          _piq: {
            schemaVersion: PIQ_SCHEMA_VERSION,
            kind: "tool-call",
            sessionId,
            branchLeafId: leafId,
            branchOrder: order,
            blockIndex,
            entryId: entry.id ?? null,
            timestamp: timestampOf(entry),
          },
          entry,
          tool,
        });
      }
    }
    if (mode !== "tool-calls" && messageRole === "toolResult") {
      records.push({
        _piq: {
          schemaVersion: PIQ_SCHEMA_VERSION,
          kind: "tool-result",
          sessionId,
          branchLeafId: leafId,
          branchOrder: order,
          entryId: entry.id ?? null,
          timestamp: timestampOf(entry),
        },
        entry,
        toolResult: entry.message,
      });
    }
  }
  return records;
}

function throughCompactionBoundary(branch, compactionId) {
  if (!compactionId) return branch;
  const index =
    compactionId === "latest"
      ? branch.reduce(
          (latest, entry, order) =>
            entry?.type === "compaction" ? order : latest,
          -1,
        )
      : branch.findIndex((entry) => entry?.id === compactionId);
  if (index < 0)
    throw piqError(
      `Branch has no compaction boundary with ID ${compactionId}`,
    );
  if (branch[index]?.type !== "compaction")
    throw piqError(`Session entry ${compactionId} is not a compaction boundary`);
  return branch.slice(0, index + 1);
}

export function filterPiSessionEntries(
  branch,
  {
    sessionId = null,
    leafId = null,
    role = null,
    entryId = null,
    from = null,
    to = null,
    throughCompaction = null,
  } = {},
) {
  const bounded = throughCompaction
    ? throughCompactionBoundary(branch, throughCompaction)
    : branch;
  return bounded
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) =>
      entryId === null || entryId === undefined ? true : entry.id === entryId,
    )
    .filter(({ entry }) => roleMatches(entry, role))
    .filter(({ entry }) => inDateRange(entry, from, to))
    .map(({ entry, order }) => entryRecord(entry, order, sessionId, leafId));
}

export function queryPiSessionEntries(loaded, options = {}) {
  const from = normalizeDate(options.from, FROM_FLAG);
  const to = normalizeDate(options.to, "--to");
  if (from !== null && to !== null && from > to)
    throw piqError(`${FROM_FLAG} must not be later than --to`);
  return filterPiSessionEntries(loaded.branch, {
    ...options,
    sessionId: loaded.parsed.header.id,
    leafId: loaded.leafId,
    from,
    to,
    throughCompaction: options.throughCompaction,
  });
}

export function queryPiSessionTools(loaded, options = {}) {
  const from = normalizeDate(options.from, FROM_FLAG);
  const to = normalizeDate(options.to, "--to");
  if (from !== null && to !== null && from > to)
    throw piqError(`${FROM_FLAG} must not be later than --to`);
  if (
    options.role &&
    !["assistant", "toolResult", "tool"].includes(options.role)
  )
    throw piqError(
      `Tool queries support only assistant, toolResult, or tool roles; received ${options.role}`,
    );
  const records = toolRecords(
    throughCompactionBoundary(loaded.branch, options.throughCompaction),
    loaded.parsed.header.id,
    loaded.leafId,
    options.kind === "tool-results"
      ? "tool-results"
      : options.kind === "tool-calls"
        ? "tool-calls"
        : "both",
  );
  return records.filter(({ _piq }) => {
    const time = Date.parse(_piq.timestamp ?? "");
    const roleMatches =
      !options.role ||
      (options.role === "assistant" && _piq.kind === "tool-call") ||
      ((options.role === "toolResult" || options.role === "tool") &&
        _piq.kind === "tool-result");
    return (
      roleMatches &&
      (options.entryId === undefined ||
        options.entryId === null ||
        _piq.entryId === options.entryId) &&
      (from === null || (Number.isFinite(time) && time >= from)) &&
      (to === null || (Number.isFinite(time) && time <= to))
    );
  });
}

export function queryPiSessionCompactions(loaded, options = {}) {
  return queryPiSessionEntries(loaded, options).filter(
    ({ entry }) => entry?.type === "compaction",
  );
}

export function queryPiSessionBranches(loaded) {
  return listSessionBranches(loaded.parsed).map((branch) => ({
    _piq: {
      schemaVersion: PIQ_SCHEMA_VERSION,
      kind: "branch",
      sessionId: loaded.parsed.header.id,
      branchLeafId: branch.leafId,
    },
    ...branch,
    entryIds: resolveSessionBranch(
      loaded.parsed,
      { leafId: branch.leafId },
      "Pi Session",
    ).map((entry) => entry.id ?? null),
  }));
}

/** Load once, resolve one explicit/default ancestry, then answer one PiQ. */
export async function queryPiQ(
  reference,
  { kind = "entries", sessionRoot, leafId = null, ...options } = {},
) {
  if (kind === "branches" && leafId !== null)
    throw piqError("Branch listing does not support --leaf");
  const loaded = await readPiSession(reference, { sessionRoot, leafId });
  if (kind === "branches") {
    const unsupported = [
      "role",
      "entryId",
      "f" + "rom",
      "to",
      "throughCompaction",
    ].filter((name) => options[name] !== undefined && options[name] !== null);
    if (unsupported.length)
      throw piqError(
        `Branch listing does not support filters: ${unsupported.join(", ")}`,
      );
  }
  switch (kind) {
    case "entries":
      return queryPiSessionEntries(loaded, options);
    case "tools":
    case "tool-calls":
    case "tool-results":
      return queryPiSessionTools(loaded, { ...options, kind });
    case "compactions":
      return queryPiSessionCompactions(loaded, options);
    case "branches":
      return queryPiSessionBranches(loaded);
    default:
      throw piqError(`Unknown PiQ query: ${kind}`);
  }
}
