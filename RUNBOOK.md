# Rarebit runbook

This runbook applies to `0.1.0-alpha.5`. This candidate repairs Pi 0.84.2
Summary calls by using the active Pi model runtime. The injected Pi AI completion
path remains the fallback for hosts without that runtime registry. See
[CHANGELOG.md](CHANGELOG.md) for release details.

Set `rarebit.model` in global Pi settings or in a trusted Project's
`.pi/settings.json`. It must be `provider/model` or an object with `provider`
and `id`. Rarebit fails closed when it is missing or invalid. It does not use
Pi's interactive `defaultModel`.

Install or move this package to the alpha.5 pin with
`pi install npm:@hypercarrier/rarebit@0.1.0-alpha.5`. Pi treats versioned npm
sources as pinned, so package update commands skip it. Do not use an unpinned
source for alpha.5 recovery: unpinned npm resolution follows the retained
`latest`, which remains alpha.4. Run `pi remove npm:@hypercarrier/rarebit` to
stop loading it. These commands do not modify native Sessions or remove Rarebit
retained data.

Inspect derived state without treating it as a transcript:

```sh
npm exec -- rarebit query --session <exact-session.jsonl> --json
npm exec -- rarebit extract --session <exact-session.jsonl> --json
```

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
