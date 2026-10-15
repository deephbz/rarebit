import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import fc from 'fast-check';
import { checkWorld, replayProjection } from './monitors.mjs';
const exec = promisify(execFile);
const measurements = [];
async function run(scenario) {
  const { stdout } = await exec(process.execPath, ['sim/replay.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, RAREBIT_SIM_SCENARIO: JSON.stringify(scenario) }, timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
  const history = JSON.parse(stdout); measurements.push(history); return history;
}

test('R2–R7 real extension, HTTP requests, Summary reuse, compaction and native tree', async () => {
  const actions = ['turn', 'summary', 'summary', 'turn', 'summary', 'recall', 'compact', 'turn', 'branch', 'turn'];
  const h = await run({ seed: 12, actions }); checkWorld(h, { prefix: false });
  assert.deepEqual(h.summaries.map(s => s.duplicate), [false, true, false], 'R3 duplicate suppression');
  assert.equal(h.requests.filter(r => r.kind === 'summary').length, 2, 'R3 changed evidence causes new request');
  const before = h.snapshots[5], compacted = h.snapshots[6];
  assert.ok(compacted.entries.some(e => e.type === 'compaction'), 'R6 real Pi compaction persisted');
  assert.deepEqual(compacted.selection, before.selection, 'R6 pre-compaction selection remains complete');
  const nextRequest = h.requests.filter(r => r.kind === 'interactive').at(-2);
  assert.ok(JSON.stringify(nextRequest.body).includes(compacted.entries.find(e => e.type === 'compaction').summary.replaceAll('\n', '\\n')), 'R6 native compaction summary reaches provider');
  assert.equal(JSON.stringify(nextRequest.body).includes('Synthetic request 0'), false, 'R6 model context excludes compacted raw prefix');
  const siblingIds = h.snapshots[7].selection.occurrences.map(o => o.sourceEntryId);
  assert.ok(siblingIds.every(id => !h.snapshots.at(-1).selection.occurrences.some(o => o.sourceEntryId === id)), 'R7 abandoned sibling excluded');
});

test('R4 linear Summary request prefixes; R9 exact seeded replay twice for two seeds', async () => {
  for (const seed of [7, 29]) {
    const scenario = { seed, actions: ['turn', 'summary', 'turn', 'summary', 'recall'] };
    const a = await run(scenario), b = await run(scenario);
    checkWorld(a); checkWorld(b);
    assert.deepEqual(replayProjection(a), replayProjection(b), `R9 seed ${seed}`);
  }
});

test('R9 host lstat latency cannot move seeded inputs, commit retries, or Recall timestamps', async () => {
  const scenario = { seed: 1, mutant: 'prefix-hash', actions: ['turn', 'summary', 'turn', 'summary'] };
  const baseline = await run(scenario);
  const delayed = await run({...scenario, lstatDelayMs: 30});
  assert.throws(() => checkWorld(baseline), /R4/);
  assert.throws(() => checkWorld(delayed), /R4/);
  assert.deepEqual(replayProjection(delayed), replayProjection(baseline), 'R9 delayed real lstat');
});

test('seeded HTTP campaign with fast-check shrinking', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), fc.array(fc.constantFrom('turn', 'summary', 'error'), { minLength: 1, maxLength: 5 }), async (seed, tail) => {
    const scenario = { seed, actions: ['turn', 'summary', ...tail, 'turn', 'summary'] };
    try { checkWorld(await run(scenario)); }
    catch (error) { error.message += `\nReplay: ${JSON.stringify(scenario)}`; throw error; }
  }), { seed: 20261015, numRuns: Number(process.env.RAREBIT_SIM_RUNS ?? 8), endOnFailure: false });
});

test('mutant gate: two minimal production-path counterexamples replay identically', async () => {
  for (const [file, property] of [['include-error.json', /R1/], ['prefix-hash.json', /R4/]]) {
    const scenario = JSON.parse(await readFile(new URL(`fixtures/${file}`, import.meta.url), 'utf8'));
    const a = await run(scenario), b = await run(scenario);
    assert.throws(() => checkWorld(a), property);
    assert.deepEqual(replayProjection(a), replayProjection(b), 'R9 mutant replay');
    const control = await run({ ...scenario, mutant: null }); checkWorld(control);
  }
});

test('report measured virtual/wall speed', () => {
  const wallMs = measurements.reduce((s, h) => s + h.wallMs, 0);
  const virtualMs = measurements.reduce((s, h) => s + h.virtualMs, 0);
  console.log(JSON.stringify({ worlds: measurements.length, virtualMs, wallMs: Math.round(wallMs), speedRatio: Number((virtualMs / wallMs).toFixed(2)), piVersions: [...new Set(measurements.map(h => h.version))] }));
});
