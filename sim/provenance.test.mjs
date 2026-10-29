import "../test/home.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatorEvidence } from './pi-sim.mjs';
const exec = promisify(execFile);

test('packed simulator provenance never reports an unrelated consumer Git HEAD', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rarebit-packed-provenance-'));
  const env = {...process.env};
  delete env.HC_PI_SIM_PATH; delete env.RAREBIT_SIM_PI_ROOT;
  const run = (command, args, cwd = root) => exec(command, args, {cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024});
  try {
    const source = process.env.HC_PI_SIM_PATH ? resolve(process.env.HC_PI_SIM_PATH)
      : dirname(dirname(fileURLToPath(import.meta.resolve('@hypercarrier/pi-sim'))));
    const {stdout} = await run('npm', ['pack', '--json', '--pack-destination', root], source);
    const [{filename}] = JSON.parse(stdout);
    await writeFile(join(root, 'package.json'), JSON.stringify({private: true, type: 'module'}));
    await run('git', ['init', '-q']);
    await run('git', ['config', 'user.name', 'deephbz']);
    await run('git', ['config', 'user.email', '13776377+deephbz@users.noreply.github.com']);
    await run('git', ['add', 'package.json']);
    await run('git', ['commit', '-qm', 'Synthetic consumer fixture']);
    const consumerRevision = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    await run('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', join(root, filename)]);
    const lane = join(root, 'lane'); await mkdir(lane);
    await copyFile(new URL('./pi-sim.mjs', import.meta.url), join(lane, 'pi-sim.mjs'));
    await copyFile(new URL('./package.json', import.meta.url), join(lane, 'package.json'));
    const probe = (await run(process.execPath, ['--input-type=module', '-e', "import {simulatorEvidence} from './lane/pi-sim.mjs'; console.log(JSON.stringify(simulatorEvidence));"])).stdout;
    const evidence = JSON.parse(probe);
    assert.notEqual(evidence.sourceRevision, consumerRevision, 'consumer HEAD is not simulator provenance');
    assert.equal(evidence.sourceRevision, 'unknown (packed)');
    assert.equal(evidence.version, simulatorEvidence.version);
    assert.match(simulatorEvidence.sourceRevision, /^[a-f0-9]{40}$/, 'tracked workspace source retains its revision');
  } finally {await rm(root, {recursive: true, force: true});}
});
