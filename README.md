# Rarebit

`@hypercarrier/rarebit` recovers decision-bearing conversational evidence from
one persisted Pi Session. It deterministically selects readable user prose and
assistant continuation or stop prose on the active branch. It excludes tool
payloads, tool results, and hidden reasoning.

Rarebit is public alpha software. Its CLI output, exports, sidecar protocol,
and visual language can change. It is not a Task, Project, runtime, priority,
attention, or delivery authority. Native Pi Session JSONL remains the evidence
authority.

## Install

Use Node 22 or later and Pi 0.83 or later. Install it in Pi from npm:

```sh
pi install npm:@hypercarrier/rarebit@0.1.0-alpha.1
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

To use only the CLI in a Node project:

```sh
npm install @hypercarrier/rarebit@0.1.0-alpha.1
```

## First query and extract

Give the CLI an exact Session JSONL path or supported Pi Session identifier.
`query` returns metadata only. `extract` returns selected raw Session prose.

```sh
rarebit query --session /absolute/path/to/session.jsonl --json
rarebit extract --session /absolute/path/to/session.jsonl --json
```

The Pi extension adds `/rarebit` controls after installation. It has `status`,
`config`, `auto-title`, `title`, `summarize`, and `recall` subcommands.

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
rarebit summarize --session /absolute/path/to/session.jsonl --json --force
rarebit title --session /absolute/path/to/session.jsonl --json
```

A Summary is a lossy assessment of an identified selection. It can report only
Session-scoped appearance, not completed Project or Task work. A Title is a
mutable label proposal, not Session identity. Automatic Summary work runs only
at persisted owner-input or settled-agent boundaries and only when its policy
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

`/rarebit recall <prompt>` is human-only. It writes the complete selected
content to a new OS temporary directory, then sends one Pi user message with
absolute paths to those files. The directory is mode 0700 and its JSON files
are mode 0600, but temporary Recall files and the persisted Pi message are
sensitive. Remove them when you no longer need them.

## Update, uninstall, and rollback

Pin alpha versions for reproducible installs:

```sh
pi install npm:@hypercarrier/rarebit@0.1.0-alpha.1
pi update npm:@hypercarrier/rarebit
pi remove npm:@hypercarrier/rarebit
```

To roll back, reinstall a known version with `pi install npm:@hypercarrier/rarebit@<version>`.
Removal stops package loading. It does not alter Pi Session JSONL or delete
Rarebit sidecars, job leases, or Recall temp files. Remove retained local data
only after you review it.

## Compatibility and support

This alpha supports Node 22+ and Pi 0.83+. It works as a deterministic CLI
without a model. Summary, Title, and the Pi extension require a compatible Pi
installation and configured provider credentials.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
Use https://github.com/deephbz/rarebit/issues for normal support. Include no
Session prose, credentials, or Recall files in public reports.

See [RUNBOOK.md](RUNBOOK.md) for recovery and sidecar details, and
[VISUAL-LANGUAGE.md](VISUAL-LANGUAGE.md) for evidence-mark meaning.
