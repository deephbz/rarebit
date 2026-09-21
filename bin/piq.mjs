#!/usr/bin/env node
import { PIQ_CLI_USAGE, parsePiQCliArgs, runPiQCli } from "../src/piq-cli.mjs";

try {
  const options = parsePiQCliArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(`${PIQ_CLI_USAGE}\n`);
  else {
    const records = await runPiQCli(options);
    for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error?.message ?? String(error)}\n${PIQ_CLI_USAGE}\n`);
  process.exitCode = 1;
}
