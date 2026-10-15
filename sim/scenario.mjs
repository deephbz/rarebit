// Rarebit owns scenarios, mutant source, and observations. The shared simulator
// owns Pi construction, HTTP encoding, clocks, entropy, storage, and settlement.
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SimWorld, delayHostIO, simulatorEvidence } from './pi-sim.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const epoch = Date.parse('2026-01-01T00:00:00Z');
const classify = request => JSON.stringify(request.body).includes('RAREBIT_MESSAGES_JSONL') ? 'summary' : 'interactive';

export async function runScenario({ seed = 1, actions = ['turn', 'summary', 'turn', 'summary'], mutant = null, lstatDelayMs = 0 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be a uint32');
  if (!Array.isArray(actions) || actions.length > 1000 || actions.some(action => !['turn', 'summary', 'error', 'compact', 'branch', 'recall'].includes(action))) throw new TypeError('Invalid action trace');
  const root = join(tmpdir(), `rarebit-sim-seed-${seed}`);
  const normalize = value => JSON.parse(JSON.stringify(value).split(root).join('<world>'));
  let config, core, processRarebitSummary, materializeRarebitRecall;
  const world = await SimWorld.create({
    seed, epoch, root, family: 'anthropic', sessionStorage: 'durable',
    hostIOLatency: lstatDelayMs ? delayHostIO({operations: ['lstat'], delayMs: lstatDelayMs}) : undefined,
    settings: {compaction: {enabled: false, keepRecentTokens: 1, reserveTokens: 512}},
    replies: (request, {entropy}) => ({
      delayMs: 20 + entropy.choose(80, 'provider-latency'),
      text: classify(request) === 'summary'
        ? JSON.stringify({summary: 'Synthetic work complete.', sessionStatus: 'finished', statusReason: 'all_requests_accomplished'})
        : `Synthetic reply ${entropy.choose(1000, 'reply-text')}`,
    }),
    setup: async ({sessionDir, model}) => {
      let source = repo;
      if (mutant) {
        source = join(root, 'mutant'); await mkdir(source); await cp(join(repo, 'src'), join(source, 'src'), {recursive: true});
        const path = join(source, 'src', 'rarebit-core.mjs');
        let text = await readFile(path, 'utf8');
        if (mutant === 'include-error') text = text.replace('message.stopReason === "stop")', '(message.stopReason === "stop" || message.stopReason === "error"))');
        else if (mutant === 'prefix-hash') text = text.replace('"You are the HyperCarrier Rarebit summarizer.",', '"You are the HyperCarrier Rarebit summarizer. " + sha256(messages),');
        else throw new Error(`Unknown mutant ${mutant}`);
        await writeFile(path, text);
      }
      core = await import(pathToFileURL(join(source, 'src/rarebit-core.mjs')).href);
      const {default: register} = await import(pathToFileURL(join(source, 'src/extension.mjs')).href);
      ({processRarebitSummary} = await import(pathToFileURL(join(source, 'src/rarebit-service.mjs')).href));
      ({materializeRarebitRecall} = await import(pathToFileURL(join(source, 'src/rarebit-recall.mjs')).href));
      config = {model: {provider: model.provider, id: model.id}, autoTitle: false, recap: {enabled: false}, sessionRoot: sessionDir, rarebitRoot: join(root, 'receipts'), allowExternalSession: true, summaryPolicy: {minTotalLength: 1e9, maxRarebitRatio: 1}};
      return {extensionFactories: [api => register(api, config)]};
    },
  });
  const snapshots = [], summaries = [], recalls = [], failures = [];
  try {
    const manager = world.sessionManager, session = world.session;
    const ctx = {sessionManager: manager, modelRegistry: new world.sdk.ModelRegistry(world.modelRuntime), cwd: world.cwd};
    if (typeof ctx.modelRegistry.complete !== 'function') throw new Error('Selected Pi model adapter lacks native completion');
    for (const [index, action] of actions.entries()) {
      const deadline = epoch + (index + 1) * 10000 + world.entropy.choose(1000, 'input-delay');
      if (deadline < world.scheduler.now) throw new Error('Scenario exceeded its seeded input deadline');
      await world.advance(deadline - world.scheduler.now);
      const prior = normalize(manager.getEntries());
      if (action === 'turn') await world.prompt(`Synthetic request ${index}`);
      else if (action === 'summary') summaries.push(await world.run(() => processRarebitSummary(ctx, {...config, forceSynthesis: true})));
      else if (action === 'error') await world.run(() => manager.appendMessage({role: 'assistant', content: [{type: 'text', text: 'Synthetic exceptional response'}], stopReason: 'error', timestamp: Date.now()}));
      else if (action === 'compact') await world.run(() => session.compact('Retain synthetic intent.'));
      else if (action === 'branch') {
        const target = manager.getBranch().find(e => e.message?.role === 'user');
        if (target) await world.run(() => session.navigateTree(target.id, {summarize: false}));
      } else if (action === 'recall') {
        const cut = normalize(manager.getBranch());
        await world.prompt('/rarebit recall Recover synthetic intent', {streamingBehavior: 'steer'});
        await world.run(async () => {
          while (!manager.getBranch().some(e => (JSON.stringify(e.message?.content) ?? '').includes('# Rarebit Recall')) || session.isStreaming || manager.getBranch().at(-1)?.message?.role !== 'assistant') await new Promise(resolve => setTimeout(resolve, 5));
        });
        const envelope = manager.getBranch().filter(e => e.message?.role === 'user').at(-1)?.message.content[0].text;
        const paths = [...(envelope ?? '').matchAll(/```text\n([^\n]*rarebit-(?:conversation|evidence)\.json)\n```/g)].map(m => m[1]);
        const docs = await world.run(() => Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8')))));
        recalls.push({cut, docs, envelope});
      }
      const entries = normalize(manager.getEntries());
      for (const entry of prior) if (JSON.stringify(entries.find(e => e.id === entry.id)) !== JSON.stringify(entry)) failures.push({property: 'R5', action, entryId: entry.id});
      const branch = manager.getBranch();
      snapshots.push({action, entries, branch: normalize(branch), selection: core.selectRarebits(branch)});
    }
    if (manager.getSessionFile()) {
      await world.run(async () => {
        const bundle = await materializeRarebitRecall(ctx, {tempRoot: root});
        recalls.push({cut: normalize(manager.getBranch()), docs: [JSON.parse(await readFile(bundle.conversationPath, 'utf8')), JSON.parse(await readFile(bundle.detailedPath, 'utf8'))]});
        await bundle.discard();
      });
    }
    world.assertHealthy();
    const report = world.report();
    return normalize({version: world.piVersion, simulator: simulatorEvidence, seed, actions,
      requests: world.requests.map(request => ({...request, kind: classify(request)})), snapshots, recalls,
      summaries: summaries.map(r => ({duplicate: r.duplicate === true, status: r.record?.status, jobId: r.record?.jobId})), failures,
      choices: world.history.filter(event => event.kind === 'entropy').map(event => event.data),
      virtualMs: report.metrics.virtualMs, wallMs: report.metrics.wallMs});
  } finally {await world.close();}
}
