import assert from "node:assert/strict";
import test from "node:test";

import {
  getRarebitArgumentCompletions,
  parseRarebitCommand,
  rarebitCommandDescription,
  rarebitCommandUsage,
} from "../src/rarebit-command.mjs";

const values = (prefix) =>
  getRarebitArgumentCompletions(prefix)?.map(({ value }) => value) ?? null;

test("one grammar derives command description and usage", () => {
  assert.equal(
    rarebitCommandDescription(),
    "Rarebit status/recall/fork/config/auto-title/title/summarize",
  );
  assert.equal(
    rarebitCommandUsage(),
    "Usage: /rarebit [status|recall|fork|config|auto-title|title|summarize]",
  );
  assert.equal(
    rarebitCommandUsage("config"),
    "Usage: /rarebit config [max_rarebit_ratio <0..1>|min_total_length <nonnegative estimated tokens>]",
  );
  assert.equal(
    rarebitCommandUsage("auto-title"),
    "Usage: /rarebit auto-title [on|off]",
  );
  assert.equal(
    rarebitCommandUsage("title"),
    "Usage: /rarebit title (use Pi's native /name for a literal title)",
  );
  assert.equal(
    rarebitCommandUsage("recall"),
    "Usage: /rarebit recall <prompt...>",
  );
});

test("parser accepts exactly the command grammar", () => {
  assert.deepEqual(parseRarebitCommand(""), {
    ok: true,
    subcommand: "status",
    arguments: [],
  });
  assert.equal(parseRarebitCommand("fork").ok, true);
  assert.equal(parseRarebitCommand("fork --max-token-length 64000").ok, true);
  assert.equal(parseRarebitCommand("config").ok, true);
  assert.equal(parseRarebitCommand("config max_rarebit_ratio 0.4").ok, true);
  assert.equal(parseRarebitCommand("config min_total_length 80000").ok, true);
  assert.equal(parseRarebitCommand("auto-title on").ok, true);
  assert.equal(parseRarebitCommand("auto-title off").ok, true);
  assert.equal(parseRarebitCommand("title").ok, true);
  assert.equal(parseRarebitCommand("summarize").ok, true);
  assert.deepEqual(
    parseRarebitCommand(
      "recall Review the evidence, then  continue exactly.  ",
    ),
    {
      ok: true,
      subcommand: "recall",
      arguments: ["Review the evidence, then  continue exactly.  "],
    },
  );

  assert.equal(parseRarebitCommand("unknown").error, "unknown_subcommand");
  assert.equal(parseRarebitCommand("status now").error, "invalid_arguments");
  assert.equal(
    parseRarebitCommand("config max_rarebit_ratio 2").error,
    "invalid_value",
  );
  assert.equal(
    parseRarebitCommand("config min_total_length -1").error,
    "invalid_value",
  );
  assert.equal(
    parseRarebitCommand("auto-title maybe").error,
    "invalid_arguments",
  );
  assert.equal(parseRarebitCommand("title literal").error, "invalid_arguments");
  assert.equal(
    parseRarebitCommand("summarize again").error,
    "invalid_arguments",
  );
  assert.equal(parseRarebitCommand("recall").error, "invalid_arguments");
  assert.equal(parseRarebitCommand("recall   ").error, "invalid_arguments");
  assert.equal(
    parseRarebitCommand("dump messages legacy grammar").error,
    "unknown_subcommand",
  );
});

test("autocomplete covers subcommands and discrete nested arguments", () => {
  assert.deepEqual(values(""), [
    "status",
    "recall",
    "fork",
    "config",
    "auto-title",
    "title",
    "summarize",
  ]);
  assert.deepEqual(values("s"), ["status", "summarize"]);
  assert.deepEqual(values("config "), [
    "config max_rarebit_ratio ",
    "config min_total_length ",
  ]);
  assert.deepEqual(values("config m"), [
    "config max_rarebit_ratio ",
    "config min_total_length ",
  ]);
  assert.deepEqual(values("auto-title "), ["auto-title on", "auto-title off"]);
  assert.deepEqual(values("auto-title o"), ["auto-title on", "auto-title off"]);
  assert.equal(values("recall "), null);
  assert.equal(values("recall p"), null);
});

test("autocomplete stops at free-form and terminal arguments", () => {
  assert.equal(values("config max_rarebit_ratio "), null);
  assert.equal(values("config max_rarebit_ratio 0.4"), null);
  assert.equal(values("config max_rarebit_ratio 0.4 "), null);
  assert.equal(values("auto-title on "), null);
  assert.equal(values("status "), null);
  assert.equal(values("title "), null);
  assert.equal(values("summarize "), null);
  assert.equal(values("unknown "), null);
  assert.equal(values("recall "), null);
  assert.equal(values("recall long free-form prompt"), null);
});
