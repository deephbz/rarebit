export const RAREBIT_FORK_LINEAGE_SCHEMA_VERSION = 1;
export const RAREBIT_FORK_ENTRY_MARKER_VERSION = "rarebit-fork-entry/1";
export const RAREBIT_FORK_LINEAGE_CUSTOM_TYPE = "rarebit-fork-lineage";
export const RAREBIT_FORK_OPENING_MARKER = "rarebit-fork-opening-v1";

function validMarker(marker) {
  return (
    marker &&
    typeof marker === "object" &&
    marker.version === RAREBIT_FORK_ENTRY_MARKER_VERSION &&
    (marker.kind === "seed" || marker.kind === "import")
  );
}

function entriesWithIds(entries) {
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) => typeof entry?.id === "string" && entry.id,
  );
}

function lineageRecords(entries) {
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) =>
      entry?.type === "custom" &&
      entry.customType === RAREBIT_FORK_LINEAGE_CUSTOM_TYPE &&
      entry.data?.schemaVersion === RAREBIT_FORK_LINEAGE_SCHEMA_VERSION,
  );
}

/**
 * Return only destination entry IDs present in the supplied entries. This
 * intentionally does not resolve parentSession or return source ancestor IDs,
 * so bounded head/tail consumers can classify a marker without a full scan.
 */
export function getImportedRarebitEntryIds(entries) {
  const supplied = new Set(entriesWithIds(entries).map((entry) => entry.id));
  const ids = new Set();
  for (const entry of entriesWithIds(entries)) {
    if (validMarker(entry.rarebitFork)) ids.add(entry.id);
  }
  for (const record of lineageRecords(entries)) {
    const data = record.data;
    const imported = Array.isArray(data.importedEntryIds)
      ? data.importedEntryIds
      : [];
    for (const id of [data.opening?.seedEntryId, ...imported]) {
      if (typeof id === "string" && supplied.has(id)) ids.add(id);
    }
  }
  return ids;
}

export function getRarebitForkSeedEntryIds(entries) {
  const supplied = new Set(entriesWithIds(entries).map((entry) => entry.id));
  const ids = new Set();
  for (const entry of entriesWithIds(entries)) {
    if (validMarker(entry.rarebitFork) && entry.rarebitFork.kind === "seed")
      ids.add(entry.id);
  }
  for (const record of lineageRecords(entries)) {
    const id = record.data.opening?.seedEntryId;
    if (typeof id === "string" && supplied.has(id)) ids.add(id);
  }
  return ids;
}

export function getRarebitForkLineageRecords(entries) {
  return lineageRecords(entries).map((entry) => entry.data);
}
