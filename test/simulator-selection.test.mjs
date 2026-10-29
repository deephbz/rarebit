import "./home.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { selectRarebits } from '../src/rarebit-core.mjs';
import { parseNativeSession, resolveActiveBranch } from '../src/rarebit-session.mjs';
import { checkSelection } from './helpers/selection-monitor.mjs';

test('R1 exhaustive role/outcome/content pairs; R8 old and current native formats', () => {
  const entries = [];
  for (const role of ['user', 'assistant', 'toolResult']) for (const stopReason of ['stop', 'toolUse', 'error', 'aborted', 'length', undefined]) for (const content of ['prose', [{ type: 'text', text: 'prose' }, { type: 'thinking', thinking: 'private reasoning' }], [{ type: 'toolCall', id: 'synthetic', name: 'read', arguments: {} }], []]) entries.push({ type: 'message', message: { role, stopReason, content } });
  let count = 0;
  for (const a of entries) for (const b of entries) {
    const branch = [a, b].map((e, i) => ({ ...e, id: `e${i}`, parentId: i ? 'e0' : null }));
    checkSelection(selectRarebits(branch), branch); count++;
  }
  assert.equal(count, 5184);
  for (const version of [1, 2, 3]) {
    const branch = entries.map((e, i) => ({ ...e, id: `e${i}`, parentId: i ? `e${i-1}` : null, legacyExtra: 'retained' }));
    const original = JSON.stringify([{ type: 'session', id: 'synthetic-old', version }, ...branch]);
    const parsed = parseNativeSession(JSON.parse(original).map(e => JSON.stringify(e)).join('\n'));
    checkSelection(selectRarebits(resolveActiveBranch(parsed)), branch);
    assert.equal(JSON.stringify([parsed.header, ...parsed.entries]), original, 'R8 no read-time migration');
  }
});

test('R1/R8 fast-check mixed native evidence with shrinking', () => {
  fc.assert(fc.property(fc.array(fc.record({ role: fc.constantFrom('user', 'assistant', 'toolResult'), stopReason: fc.constantFrom('stop', 'toolUse', 'error', 'aborted'), text: fc.string({ maxLength: 100 }) }), { maxLength: 30 }), records => {
    const branch = records.map((r, i) => ({ type: 'message', id: `e${i}`, parentId: i ? `e${i-1}` : null, message: { role: r.role, stopReason: r.stopReason, content: [{ type: 'text', text: r.text }] } }));
    checkSelection(selectRarebits(branch), branch);
  }), { seed: 20261015, numRuns: 100 });
});
