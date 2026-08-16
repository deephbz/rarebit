import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const piVersion = "0.83.0";
const work = await mkdtemp(join(tmpdir(), "rarebit-pi083-recall-"));

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

try {
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work]),
  )[0];
  const tarball = join(work, packed.filename);
  run("npm", ["init", "-y"], work);
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      tarball,
      `@earendil-works/pi-coding-agent@${piVersion}`,
    ],
    work,
  );
  const installedRoot = join(
    work,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  const recall = join(
    work,
    "node_modules",
    "@hypercarrier",
    "rarebit",
    "scripts",
    "e2e-recall-pi0842.mjs",
  );
  const result = spawnSync(process.execPath, [recall], {
    cwd: work,
    encoding: "utf8",
    env: {
      ...process.env,
      PI_CODING_AGENT_ROOT: installedRoot,
      RAREBIT_EXPECTED_PI_VERSION: piVersion,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write(`Pi ${piVersion} Recall E2E passed from the packed artifact.\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
