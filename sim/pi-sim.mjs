// The private simulator serves this R&D lane. Public installation and runtime
// never resolve it. Explicit overrides fail without falling back to a workspace.
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.env.RAREBIT_SIM_PI_ROOT !== undefined) {
  throw new Error('RAREBIT_SIM_PI_ROOT was removed. Set HC_PI_SIM_PI_ROOT to the @earendil-works directory containing pi-coding-agent and pi-ai.');
}
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const expected = manifest.devDependencies['@hypercarrier/pi-sim'];
let entry;
if (process.env.HC_PI_SIM_PATH !== undefined) {
  try {
    const root = await realpath(resolve(process.env.HC_PI_SIM_PATH));
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    if (pkg.name !== '@hypercarrier/pi-sim' || pkg.version !== expected) throw new Error(`Expected @hypercarrier/pi-sim ${expected}`);
    entry = pathToFileURL(createRequire(resolve(root, 'package.json')).resolve('@hypercarrier/pi-sim')).href;
    const rel = relative(root, fileURLToPath(entry));
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Package entry resolves outside HC_PI_SIM_PATH');
  } catch (cause) { throw new Error(`Invalid HC_PI_SIM_PATH: expected simulator package root @hypercarrier/pi-sim ${expected}; no fallback`, { cause }); }
} else {
  try { entry = import.meta.resolve('@hypercarrier/pi-sim'); }
  catch (cause) { throw new Error('simulator tests need the HC workspace or HC_PI_SIM_PATH', { cause }); }
}
const api = await import(entry);
if (api.SIM_API_VERSION !== expected) throw new Error(`Simulator API mismatch: expected ${expected}, received ${api.SIM_API_VERSION}`);
let sourceRevision = 'unknown (packed)';
try {
  const sourceEntry = await realpath(fileURLToPath(entry));
  const packageRoot = dirname(dirname(sourceEntry));
  const git = args => execFileSync('git', args, {cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  const top = await realpath(git(['rev-parse', '--show-toplevel']));
  const packagePath = relative(top, packageRoot);
  // An installed package cannot borrow the enclosing consumer's revision.
  if (packagePath === '' || packageRoot === resolve(top, 'packages', 'hc-pi-sim')) {
    git(['-C', top, 'ls-files', '--error-unmatch', '--', relative(top, resolve(packageRoot, 'package.json')), relative(top, sourceEntry)]);
    sourceRevision = git(['rev-parse', 'HEAD']);
  }
} catch {}
export const simulatorEvidence = { version: api.SIM_API_VERSION, sourceRevision };
export const { SimWorld, delayHostIO } = api;
