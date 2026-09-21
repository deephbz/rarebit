# Rarebit runbook

This runbook applies to `0.1.0-alpha.6`. This candidate adds bounded fork
flows, PiQ recovery, machine-only lineage, and Pi-native headroom checks. See
[CHANGELOG.md](CHANGELOG.md) for release details.

Set `rarebit.model` in global Pi settings or in a trusted Project's
`.pi/settings.json`. It must be `provider/model` or an object with `provider`
and `id`. Rarebit fails closed when it is missing or invalid. It does not use
Pi's interactive `defaultModel`.

Install or move this package to the alpha.6 pin with
`pi install npm:@hypercarrier/rarebit@0.1.0-alpha.6`. Pi treats versioned npm
sources as pinned, so package update commands skip it. Do not use an unpinned
source for alpha.6 recovery: unpinned npm resolution follows `latest`, which
remains alpha.4. Run `pi remove npm:@hypercarrier/rarebit` to
stop loading it. These commands do not modify native Sessions or remove Rarebit
retained data.

Inspect derived state without treating it as a transcript:

```sh
npm exec -- rarebit query --session <exact-session.jsonl> --json
npm exec -- rarebit extract --session <exact-session.jsonl> --json
```

To recover omitted source evidence, use the read-only PiQ binary:

```sh
node ./bin/piq.mjs entries --session <exact-session.jsonl>
```

`rarebit fork <source-path>` uses the invocation directory and Pi's normal
Session store, then launches Pi in the new Session. Add `--no-launch` for JSON
automation. Fork admission uses the target model's native
`contextWindow - reserveTokens` threshold plus prompt, tool, and per-message
rounding overhead. It refuses before switching when the seed lacks headroom.
The aggregate imported-prose budget remains `ceil(total UTF-16 characters / 4)`.
Imported entries have fork-time timestamps. Original timestamps and source model
identity remain in machine-only lineage. Legacy entries without native IDs use
`(source Session ID, sourceOrder)` and remain unmigrated.

The current protocol reads only `materializations-v4`. A `rarebit_head` is the
fenced semantic-current pointer. Do not select the physical last JSONL line.

If a crash leaves an adjacent `.commit-lock`, first verify no Rarebit writer for
that Session is alive. Then remove only that lock. Age alone does not authorize
removal.

Automatic summaries require both the configured minimum estimated length and
maximum selected-prose ratio. `npm exec -- rarebit summarize --force` and
`/rarebit summarize` are explicit requests. The receipt records input coverage.

Selected evidence contains user messages.

Recall bundles are private OS-temp files with selected content. One user
message contains the exact request and both private file pointers. When Pi is
idle it starts one turn. When Pi is busy it queues one steering message. Delete
the bundle after that turn no longer needs it. Do not put its paths or contents
in a ticket.
