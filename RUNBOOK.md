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

Selected `role:user` evidence is a user message. It does not verify a human,
owner, or producer identity. Historical `owner_request` protocol values name a
lifecycle boundary; they do not establish message authorship.

Recall bundles are private OS-temp files with selected content. The one
`role:user` envelope contains the exact request and both private file pointers.
When Pi is idle it starts one turn. When Pi is busy it queues one steering
message. Delete the bundle after that turn no longer needs it. Do not put its
paths or contents in a ticket.
