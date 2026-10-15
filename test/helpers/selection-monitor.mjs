// Independent observation of the prose-selection contract; no simulator needed.
import assert from 'node:assert/strict';
export function expectedProse(branch) {
  return branch.filter(e => e.type === 'message' && (e.message.role === 'user' || (e.message.role === 'assistant' && ['stop', 'toolUse'].includes(e.message.stopReason))))
    .map(e => ({ id: e.id ?? e.message.id ?? null, text: typeof e.message.content === 'string' ? e.message.content : (e.message.content ?? []).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n'), readable: typeof e.message.content === 'string' || (e.message.content ?? []).some(b => b.type === 'text' && typeof b.text === 'string') }))
    .filter(e => e.readable).map(({ id, text }) => ({ id, text }));
}
export function checkSelection(selection, branch) {
  assert.deepEqual(selection.occurrences.map(o => ({ id: o.sourceEntryId, text: o.text })), expectedProse(branch), 'R1 selection contract');
}
