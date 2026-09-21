import {
  DEFAULT_PI_SESSION_ROOT,
  readPiSession,
  resolvePiSessionFile,
} from "./pi-session.mjs";
import {
  RAREBIT_SELECTOR_VERSION,
  measureRarebits,
  selectRarebits,
} from "./rarebit-core.mjs";

export { DEFAULT_PI_SESSION_ROOT, parseNativeSession, resolveActiveBranch } from "./pi-session.mjs";
export const RAREBIT_QUERY_SCHEMA_VERSION = 1;
export const resolveRarebitSessionFile = resolvePiSessionFile;

function sessionProjection(parsed, branch) {
  const selection = selectRarebits(branch);
  const measurement = measureRarebits(branch, selection);
  return {
    schemaVersion: RAREBIT_QUERY_SCHEMA_VERSION,
    selectorVersion: RAREBIT_SELECTOR_VERSION,
    session: {
      id: parsed.header.id,
      activeLeafId: parsed.linear ? null : (branch.at(-1)?.id ?? null),
      // The original persisted header timestamp is provenance for a title
      // date choice; source paths and cwd intentionally remain private.
      startedAt:
        typeof parsed.header.timestamp === "string"
          ? parsed.header.timestamp
          : null,
    },
    selection,
    measurement,
  };
}

export async function readRarebitSession(reference, options = {}) {
  const loaded = await readPiSession(reference, options);
  return {
    ...loaded,
    ...sessionProjection(loaded.parsed, loaded.branch),
  };
}

/** Metadata-only projection, safe for a dashboard or programmatic inspection. */
export async function queryRarebits(reference, options = {}) {
  const result = await readRarebitSession(reference, options);
  return {
    schemaVersion: result.schemaVersion,
    selectorVersion: result.selectorVersion,
    session: result.session,
    rarebitCount: result.selection.occurrences.length,
    measurement: result.measurement,
    rarebits: result.selection.occurrences.map(
      ({ text, ...occurrence }) => occurrence,
    ),
  };
}

/** Raw selected prose remains inspectable on demand but is never a sidecar authority. */
export async function extractRarebits(reference, options = {}) {
  const result = await readRarebitSession(reference, options);
  return {
    schemaVersion: result.schemaVersion,
    selectorVersion: result.selectorVersion,
    session: result.session,
    rarebitCount: result.selection.occurrences.length,
    measurement: result.measurement,
    rarebits: result.selection.occurrences.map(
      ({ sourceEntryId, timestamp, role, outcome, text }) => ({
        sourceEntryId,
        timestamp,
        role,
        outcome,
        text,
      }),
    ),
  };
}
