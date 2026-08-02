# Rarebit runbook

Set `rarebit.model` in global Pi settings or in a trusted Project's
`.pi/settings.json`. It must be `provider/model` or an object with `provider`
and `id`. Rarebit fails closed when it is missing or invalid. It does not use
Pi's interactive `defaultModel`.

Run `pi update npm:@hypercarrier/rarebit` to update an npm installation. Run
`pi remove npm:@hypercarrier/rarebit` to stop loading it. These commands do not
modify native Sessions or remove Rarebit retained data.

Inspect derived state without treating it as a transcript:

```sh
rarebit query --session <exact-session.jsonl> --json
rarebit extract --session <exact-session.jsonl> --json
```

The current protocol reads only `materializations-v4`. A `rarebit_head` is the
fenced semantic-current pointer. Do not select the physical last JSONL line.

If a crash leaves an adjacent `.commit-lock`, first verify no Rarebit writer for
that Session is alive. Then remove only that lock. Age alone does not authorize
removal.

Automatic summaries require both the configured minimum estimated length and
maximum selected-prose ratio. `rarebit summarize --force` and `/rarebit
summarize` are explicit owner requests. The receipt records input coverage.

Recall bundles are private OS-temp files with selected content. Delete them
when their one-off Recall request is complete. Do not put their paths or
contents in a ticket.
