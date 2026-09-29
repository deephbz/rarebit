import { selectRarebits } from "./rarebit-core.mjs";
// Native custom entries are UI/read state, never provider conversation messages.
export const RECAP_ENTRY_TYPE = "rarebit-recap";
export const RECAP_READ_TYPE = "rarebit-recap-read";

export function latestRecap(branch) {
  return (Array.isArray(branch) ? branch : []).findLast((entry) =>
    entry.type === "custom" && entry.customType === RECAP_ENTRY_TYPE &&
    entry.data?.version === 1 && typeof entry.data?.jobId === "string" &&
    typeof entry.data?.coveredEntryId === "string" &&
    typeof entry.data?.selectionHash === "string");
}

export function recapReadCheckpoint(branch, selection) {
  const entries = Array.isArray(branch) ? branch : [];
  // Only active-branch markers count. Resolve their recap coverage rather than
  // the click's position: updates arriving while a recap is on screen are unread.
  for (const marker of entries.slice().reverse()) {
    if (marker.type !== "custom" || marker.customType !== RECAP_READ_TYPE ||
        marker.data?.version !== 1) continue;
    const recapIndex = entries.findIndex((entry) => entry.id === marker.data.recapEntryId);
    const recap = entries[recapIndex];
    if (recapIndex < 0 || recapIndex >= entries.indexOf(marker) ||
        recap.customType !== RECAP_ENTRY_TYPE || recap.data?.version !== 1 ||
        recap.data.jobId !== marker.data.jobId ||
        recap.data.coveredEntryId !== marker.data.coveredEntryId ||
        recap.data.selectionHash !== marker.data.selectionHash) continue;
    const covered = selection.occurrences.find((item) => item.sourceEntryId === marker.data.coveredEntryId);
    if (!covered || covered.order >= recapIndex ||
        selectRarebits(entries.slice(0, covered.order + 1)).manifestHash !== recap.data.selectionHash) continue;
    return { type: "recap_read", markerEntryId: marker.id,
      recapEntryId: recap.id, coveredEntryId: covered.sourceEntryId,
      coveredOrder: covered.order };
  }
  return null;
}
