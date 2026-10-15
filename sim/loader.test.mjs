import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test('simulator resolution rejects missing dependencies, invalid overrides, mismatches, and removed Pi selectors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rarebit-loader-'));
  try {
    await copyFile(new URL('./pi-sim.mjs', import.meta.url), join(root, 'pi-sim.mjs'));
    await copyFile(new URL('./package.json', import.meta.url), join(root, 'package.json'));
    // Refuse an inherited workspace package when TMPDIR lives inside a checkout.
    const unavailable = join(root, 'node_modules', '@hypercarrier', 'pi-sim');
    await mkdir(unavailable, {recursive: true});
    await writeFile(join(unavailable, 'package.json'), JSON.stringify({name: '@hypercarrier/pi-sim', exports: {'.': null}}));
    const env = {...process.env};
    delete env.HC_PI_SIM_PATH; delete env.RAREBIT_SIM_PI_ROOT;
    const run = extra => exec(process.execPath, ['pi-sim.mjs'], {cwd: root, env: {...env, ...extra}, timeout: 10000});
    await assert.rejects(run({}), /simulator tests need the HC workspace or HC_PI_SIM_PATH/);
    await assert.rejects(run({HC_PI_SIM_PATH: join(root, 'missing')}), /Invalid HC_PI_SIM_PATH/);
    await assert.rejects(run({RAREBIT_SIM_PI_ROOT: 'removed'}), /Set HC_PI_SIM_PI_ROOT to the @earendil-works directory/);
    const fixture = join(root, 'fixture'); await mkdir(fixture);
    await writeFile(join(fixture, 'package.json'), JSON.stringify({name:'@hypercarrier/pi-sim',version:'0.3.0',type:'module',exports:'./index.mjs'}));
    await writeFile(join(fixture, 'index.mjs'), 'export const SIM_API_VERSION="0.3.0";');
    await assert.rejects(run({HC_PI_SIM_PATH: fixture}), /Invalid HC_PI_SIM_PATH/);
    const expected = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).devDependencies['@hypercarrier/pi-sim'];
    await writeFile(join(fixture, 'package.json'), JSON.stringify({name:'@hypercarrier/pi-sim',version:expected,type:'module',exports:'./index.mjs'}));
    await assert.rejects(run({HC_PI_SIM_PATH: fixture}), /Simulator API mismatch/);
  } finally {await rm(root, {recursive:true,force:true});}
});
