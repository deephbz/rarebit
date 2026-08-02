#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
const npm = (args, cwd = root) => run("npm", args, cwd);
const required = [
  "package/README.md", "package/RUNBOOK.md", "package/VISUAL-LANGUAGE.md",
  "package/AGENTS.md", "package/CHANGELOG.md", "package/LICENSE",
  "package/SECURITY.md", "package/bin/rarebit.mjs",
  "package/src/index.mjs", "package/src/types.d.ts",
  "package/schemas/rarebit.schema.json", "package/test/rarebit-cli.test.mjs",
  "package/scripts/e2e-recall-pi083.mjs", "package/scripts/verify-package.mjs",
];
const forbiddenPath = /(^|\/)(\.git|node_modules|\.github|hc-rarebit\.mjs)(\/|$)|HyperCarrier|timeline|pi-team/i;
const allowedBare = new Set(["@earendil-works/pi-ai"]);
const packageFor = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const packed = JSON.parse(npm(["pack", "--json", "--ignore-scripts"]))[0];
const tarball = join(root, packed.filename);
const entries = run("tar", ["-tf", tarball]).trim().split("\n").filter(Boolean).sort();
for (const path of required) assert(entries.includes(path), `tarball lacks ${path}`);
for (const path of entries) assert(!forbiddenPath.test(path), `forbidden tar entry: ${path}`);
assert(!entries.includes("package/bin/hc-rarebit.mjs"), "legacy CLI is packed");

const sourceFiles = entries.filter((path) => path.endsWith(".mjs") && !path.startsWith("package/test/"));
for (const entry of sourceFiles) {
  const text = run("tar", ["-xOf", tarball, entry]);
  for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".") && !specifier.startsWith("node:") && !allowedBare.has(packageFor(specifier))) {
      throw new Error(`undeclared runtime import ${specifier} in ${entry}`);
    }
    if (allowedBare.has(packageFor(specifier))) {
      const dependency = packageFor(specifier);
      assert(packageJson.peerDependencies?.[dependency], `${dependency} lacks peer dependency`);
    }
  }
}

const temp = await mkdtemp(join(tmpdir(), "rarebit-package-"));
try {
  npm(["init", "-y"], temp);
  npm(["install", "--ignore-scripts", "--omit=dev", tarball], temp);
  const installed = "@hypercarrier/rarebit";
  for (const subpath of ["", "/core", "/session", "/service", "/artifact-state", "/visual-language", "/extension"]) {
    run(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(installed + subpath)})`], temp);
  }
  const imports = ["", "/core", "/session", "/service", "/artifact-state", "/visual-language", "/extension"]
    .map((subpath) => `import ${JSON.stringify(installed + subpath)};`).join("\n");
  await writeFile(join(temp, "imports.mts"), imports);
  run(join(root, "node_modules/.bin/tsc"), ["--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "imports.mts"], temp);
  const session = join(temp, "known-session.jsonl");
  const lines = [
    { type: "session", version: 3, id: "known-synthetic", timestamp: "2026-01-01T00:00:00.000Z" },
    { type: "message", id: "user", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Find the slow path" } },
    { type: "message", id: "assistant", parentId: "user", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", stopReason: "stop", content: "Found it" } },
  ];
  await writeFile(session, lines.map(JSON.stringify).join("\n"));
  const cli = join(temp, "node_modules", "@hypercarrier", "rarebit", "bin", "rarebit.mjs");
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:\s*\n\s+rarebit query/);
  assert.doesNotMatch(help.stdout, /hc-rarebit/);
  for (const command of ["query", "extract"]) {
    const result = spawnSync(process.execPath, [cli, command, "--session", session, "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  }
  process.stdout.write(`verified ${packed.filename} (${packed.integrity}) with ${entries.length} tar entries\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(tarball, { force: true });
}
