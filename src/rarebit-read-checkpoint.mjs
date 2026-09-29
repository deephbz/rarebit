import { selectRarebits } from "./rarebit-core.mjs";
// Native custom entries are UI/read state, never provider conversation messages.
export const RECAP_ENTRY_TYPE = "rarebit-recap";
export const RECAP_READ_TYPE = "rarebit-recap-read";

export function latestRecap(branch) {
  const entries = Array.isArray(branch) ? branch : [];
  const selection = selectRarebits(entries);
  return entries.findLast((entry, recapIndex) => {
    if (entry.type !== "custom" || entry.customType !== RECAP_ENTRY_TYPE || entry.data?.version !== 1 ||
        typeof entry.data?.jobId !== "string" || typeof entry.data?.coveredEntryId !== "string" ||
        typeof entry.data?.selectionHash !== "string") return false;
    const covered = selection.occurrences.find((item) => item.sourceEntryId === entry.data.coveredEntryId);
    const coveredIndex = covered ? entries.findIndex((item) => item.id === covered.sourceEntryId) : -1;
    return coveredIndex >= 0 && coveredIndex < recapIndex &&
      selectRarebits(entries.slice(0, coveredIndex + 1)).manifestHash === entry.data.selectionHash;
  });
}

function validatedMarker(entries, marker, selection) {
  if (marker.type !== "custom" || marker.customType !== RECAP_READ_TYPE || marker.data?.version !== 1)
    return null;
  const markerIndex = entries.indexOf(marker);
  const recapIndex = entries.findIndex((entry) => entry.id === marker.data.recapEntryId);
  const recap = entries[recapIndex];
  if (recapIndex < 0 || recapIndex >= markerIndex || recap.customType !== RECAP_ENTRY_TYPE || recap.data?.version !== 1 ||
      recap.data.jobId !== marker.data.jobId || recap.data.coveredEntryId !== marker.data.coveredEntryId ||
      recap.data.selectionHash !== marker.data.selectionHash) return null;
  const covered = selection.occurrences.find((item) => item.sourceEntryId === marker.data.coveredEntryId);
  const coveredIndex = covered ? entries.findIndex((entry) => entry.id === covered.sourceEntryId) : -1;
  if (!covered || coveredIndex < 0 || coveredIndex >= recapIndex ||
      selectRarebits(entries.slice(0, coveredIndex + 1)).manifestHash !== recap.data.selectionHash)
    return null;
  return { recap, covered };
}

export function recapIsRead(branch, recap, selection = selectRarebits(branch)) {
  const entries = Array.isArray(branch) ? branch : [];
  return entries.some((marker) => {
    const valid = validatedMarker(entries, marker, selection);
    return valid && valid.recap.data.jobId === recap?.data?.jobId &&
      valid.recap.data.coveredEntryId === recap?.data?.coveredEntryId &&
      valid.recap.data.selectionHash === recap?.data?.selectionHash;
  });
}

export function recapReadCheckpoint(branch, selection) {
  const entries = Array.isArray(branch) ? branch : [];
  // Resolve coverage against the referenced earlier Recap. A click acknowledges
  // that evidence cut, not later conversation or an unvalidated custom entry.
  for (const marker of entries.slice().reverse()) {
    const valid = validatedMarker(entries, marker, selection);
    if (!valid) continue;
    return { type: "recap_read", markerEntryId: marker.id,
      recapEntryId: valid.recap.id, coveredEntryId: valid.covered.sourceEntryId,
      coveredOrder: valid.covered.order };
  }
  return null;
}
