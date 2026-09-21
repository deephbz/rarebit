# Rarebit

`@hypercarrier/rarebit` recovers decision-bearing conversational evidence from
one persisted Pi Session. It deterministically selects readable user messages
and assistant continuation or stop prose on the active branch. It excludes tool
payloads, tool results, and hidden reasoning.

Rarebit is public alpha software. Its CLI output, exports, sidecar protocol,
and visual language can change. It is not a Task, Project, runtime, priority,
attention, or delivery authority. Native Pi Session JSONL remains the evidence
authority.

Rarebit is released from an immutable version tag by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). The workflow
runs the package gates, verifies one packed artifact, scans that artifact, and
publishes it with npm provenance. Install the exact version required by your
Pi host.

The old alpha.1, alpha.2, and alpha.3 tag graphs remain public and are not
privacy-clean. Existing package versions, tags, and releases remain immutable.
The source-only candidate derivation and vendored-scanner binding is
[`release/privacy-lineage.v1.json`](release/privacy-lineage.v1.json). It is
excluded from npm and does not claim publication completion.

## Install

Use Node 22 or later and Pi 0.83 or later. Install it in Pi from npm:

```sh
pi install npm:@hypercarrier/rarebit@0.1.0-alpha.6
pi list
```

For a local checkout, Pi loads a directory without copying it:

```sh
pi install /absolute/path/to/rarebit
pi list
```

The package imports Pi's bundled `@earendil-works/pi-ai` as a peer dependency.
Do not install or bundle a second Pi core. Pi packages execute with your user
permissions, so review source before installation.

To use the CLI in a normal Node project, install it and invoke the local bin
with npm:

```sh
npm install @hypercarrier/rarebit@0.1.0-alpha.6
npm exec -- rarebit --help
```

## First query and extract

Give the CLI an exact Session JSONL path or supported Pi Session identifier.
`query` returns metadata only. `extract` returns selected raw Session prose.

```sh
npm exec -- rarebit query --session /absolute/path/to/session.jsonl --json
npm exec -- rarebit extract --session /absolute/path/to/session.jsonl --json
```

The Pi extension adds `/rarebit` controls after installation. It has `status`,
`config`, `auto-title`, `title`, `summarize`, `recall`, and `fork` subcommands.

`/rarebit fork` validates the newest contiguous Rarebit suffix, writes a new
Session in Pi's Session store for the current working directory, and switches
to it without starting a model turn. Use `/rarebit fork --max-token-length 64000` to set the
imported prose budget. Imported messages keep their roles and source outcomes,
use zero usage, and carry machine-only lineage. The generated opening message
records source ID/path/leaf, target directory, coverage, and the read-only PiQ
recovery command. Legacy source entries retain `(sessionId, sourceOrder)` when
native entry IDs are absent; Rarebit does not migrate those sources.

The CLI performs the same operation without changing the caller's Session:

```sh
rarebit fork /absolute/source.jsonl
rarebit fork /absolute/source.jsonl --max-token-length 64000 --no-launch
```

The first form launches Pi in the invocation working directory. The second
returns JSON for automation. Fork mode requires an installed Pi coding-agent
peer; read-only query, extract, and PiQ commands do not. Use `piq entries
--session <path>` to read omitted native evidence without writing or migrating
the source.

## Model setup and optional derivations

Summary and Title use a dedicated configured model. They never inherit Pi's
interactive `defaultModel`. Put this in global Pi settings, or in a trusted
project's `.pi/settings.json`:

```json
{
  "rarebit": {
    "model": "provider/model",
    "min_total_length": 80000,
    "max_rarebit_ratio": 0.4,
    "auto_title": true
  }
}
```

Then request explicit model work when you want it:

```sh
npm exec -- rarebit summarize --session /absolute/path/to/session.jsonl --json --force
npm exec -- rarebit title --session /absolute/path/to/session.jsonl --json
```

A Summary is a lossy assessment of an identified selection. It can report only
Session-scoped appearance, not completed Project or Task work. A Title is a
mutable label proposal, not Session identity. Automatic Summary work runs only
at persisted direct-input or settled-agent boundaries and only when its policy
permits it.

## Privacy, local data, and provider egress

Rarebit reads Pi Session JSONL locally and does not modify it. `extract` prints
selected raw prose, so handle its output as sensitive.

Summary and Title send selected Rarebit prose to the provider and model that you
configure. When input exceeds the fixed limit, Rarebit sends a newest suffix
with an explicit omission marker. It does not send tool inputs, tool results,
hidden reasoning, provider credentials, or HTTP headers as Rarebit content.

Derived receipts live below `~/.pi/agent/rarebit/materializations-v4/`; job
leases live below `~/.pi/agent/rarebit/jobs-v4/`. These directories use mode
0700 and their files use mode 0600. Receipts retain compact metadata but no
selected prose, prompt, provider response body, headers, or credentials. They
remain until you remove them. Session JSONL retention is controlled by Pi.

## First Recall

Run `/rarebit recall <prompt>` in a Pi Session. Rarebit writes the exact active
branch selection to two private files: a conversation view and detailed
lineage evidence. It then sends one atomic, human-readable Markdown user
message containing your exact request and absolute pointers to both files.

When Pi is idle, that message starts one turn. When Pi is busy, it queues one
steering message. Recall does not send a second follow-up, add a custom Session
entry, or create a durable Recall receipt.

The temporary directory is mode 0700 and its JSON files are mode 0600. The
files remain after the request so Pi can read them; delete the directory after
the turn no longer needs it. Both files and the persisted Pi message are
sensitive. Do not put their paths or content in a ticket.

## Update, uninstall, and rollback

Pin alpha versions for reproducible installs:

```sh
pi install npm:@hypercarrier/rarebit@0.1.0-alpha.6
pi remove npm:@hypercarrier/rarebit
```

The exact-version install also moves an existing Rarebit npm installation to
that pin. Pi skips versioned npm sources during package updates. Do not use an
unpinned source for alpha.5 recovery: unpinned npm resolution follows the
retained `latest`, which remains alpha.4.

To roll back, reinstall a known version with `pi install npm:@hypercarrier/rarebit@<version>`.
Removal stops package loading. It does not alter Pi Session JSONL or delete
Rarebit sidecars, job leases, or Recall temp files. Remove retained local data
only after you review it.

## Compatibility and support

This alpha supports Node 22+ and Pi 0.83.0 or later. Its Pi AI peer has no
upper bound. The release gate runs Recall against Pi 0.83.0 and Pi 0.84.2. It
works as a deterministic CLI without a model. Summary, Title, and the Pi
extension require a compatible Pi installation and configured provider
credentials.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
Use https://github.com/deephbz/rarebit/issues for normal support. Include no
Session prose, credentials, or Recall files in public reports.

See [RUNBOOK.md](RUNBOOK.md) for recovery and sidecar details, and
[VISUAL-LANGUAGE.md](VISUAL-LANGUAGE.md) for evidence-mark meaning.
