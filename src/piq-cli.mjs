import { queryPiQ } from "./piq.mjs";

const FROM_FLAG = "--from";

export const PIQ_CLI_USAGE = `Usage:
  piq <entries|branches|tools|tool-calls|tool-results|compactions> --session <exact-path-or-id> [options]

Options:
  --leaf <entry-id>                 Read one explicit branch leaf (default: native active leaf)
  --entry-id <entry-id>             Restrict entries or tools to one native entry ID
  --role <role>                     Restrict entries to a native message role
  --from <ISO-8601>                 Include evidence at or after this timestamp
  --to <ISO-8601>                   Include evidence at or before this timestamp
  --through-compaction <entry-id>  Stop the branch at this compaction boundary (or latest)

PiQ writes one JSON object per result line. It never writes the source Session.`;

function value(argv, index, flag) {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`);
  return next;
}

export function parsePiQCliArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [first, ...rest] = argv;
  const commands = new Set([
    "entries",
    "branches",
    "tools",
    "tool-calls",
    "tool-results",
    "compactions",
  ]);
  const kind = commands.has(first) ? first : "entries";
  const args = commands.has(first) ? rest : argv;
  const options = { kind };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--session":
        options.session = value(args, index, argument);
        index += 1;
        break;
      case "--leaf":
        options.leafId = value(args, index, argument);
        index += 1;
        break;
      case "--entry-id":
        options.entryId = value(args, index, argument);
        index += 1;
        break;
      case "--role":
        options.role = value(args, index, argument);
        index += 1;
        break;
      case FROM_FLAG:
        options.from = value(args, index, argument);
        index += 1;
        break;
      case "--to":
        options.to = value(args, index, argument);
        index += 1;
        break;
      case "--through-compaction":
        options.throughCompaction = value(args, index, argument);
        index += 1;
        break;
      case "--session-root":
        options.sessionRoot = value(args, index, argument);
        index += 1;
        break;
      case "--jsonl":
      case "--json":
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.session) throw new Error("--session is required");
  return options;
}

export async function runPiQCli(options, dependencies = {}) {
  const query = dependencies.query ?? queryPiQ;
  return query(options.session, {
    kind: options.kind,
    leafId: options.leafId,
    sessionRoot: options.sessionRoot,
    entryId: options.entryId,
    role: options.role,
    from: options.from,
    to: options.to,
    throughCompaction: options.throughCompaction,
  });
}
