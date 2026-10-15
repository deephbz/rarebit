import { readFile, writeFile } from 'node:fs/promises';
import { runScenario } from './scenario.mjs';
import { checkWorld } from './monitors.mjs';
const input = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : JSON.parse(process.env.RAREBIT_SIM_SCENARIO ?? '{}');
const history = await runScenario(input);
if (!input.mutant) checkWorld(history, { prefix: !input.actions?.includes('branch') });
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(history, null, 2) + '\n');
else console.log(JSON.stringify(history));
