// Monitors read only recorded HTTP, public Session entries, and Recall files.
import assert from 'node:assert/strict';

import { expectedProse, checkSelection } from '../test/helpers/selection-monitor.mjs';
const promptText = request => request.body.messages.filter(m => m.role === 'user').flatMap(m => typeof m.content === 'string' ? [m.content] : m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n');
export function checkWorld(history, { prefix = true } = {}) {
  assert.deepEqual(history.failures, [], 'R5 earlier entries changed');
  for (const cut of history.snapshots) checkSelection(cut.selection, cut.branch);
  for (const recall of history.recalls) {
    assert.equal(recall.docs.length, 2, 'R2 both Recall files exist');
    const conversation = recall.docs.find(d => d.type === 'rarebit_conversation');
    const detailed = recall.docs.find(d => d.type === 'rarebit_message_recall');
    assert.deepEqual(conversation.messages.map(m => m.text), expectedProse(recall.cut).map(m => m.text), 'R2 Recall conversation order');
    assert.deepEqual(detailed.selection.occurrences.map(m => ({ id: m.sourceEntryId, text: m.text })), expectedProse(recall.cut), 'R2 Recall evidence lineage');
    assert.deepEqual(conversation.messages.map(m => m.seq), detailed.selection.occurrences.map(m => m.seq), 'R2 join identity');
  }
  for (const cut of history.snapshots) {
    assert.equal(cut.entries.some(e => e.customType === 'rarebit.recall' || e.message?.customType === 'rarebit.recall'), false, 'R2 no durable Recall entry');
    if (cut.action === 'recall') {
      const envelopes = cut.branch.filter(e => e.message?.role === 'user' && JSON.stringify(e.message.content).includes('# Rarebit Recall'));
      assert.equal(envelopes.length, 1, 'R2 exactly one Recall envelope');
    }
  }
  if (prefix) {
    const summaries = history.requests.filter(r => r.kind === 'summary');
    for (let i = 1; i < summaries.length; i++) {
      const previous = promptText(summaries[i - 1]);
      const end = previous.indexOf('\nEND_RAREBIT_MESSAGES_JSONL');
      assert.ok(end > 0, 'R4 evidence delimiter recorded');
      // Exact prefix rule: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
      // This monitor claims byte-prefix eligibility only. TTL, minimum size,
      // block boundaries, and actual cache billing remain outside this lane.
      assert.ok(promptText(summaries[i]).startsWith(previous.slice(0, end) + '\n'), 'R4 outgoing Summary evidence prefix changed');
    }
  }
}

export function replayProjection(history) {
  const { wallMs, ...stable } = history;
  return stable;
}
