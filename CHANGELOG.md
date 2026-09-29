# Changelog

## Unreleased

- Move Recap into the scrollable transcript using native custom-entry renderers,
  preserving its muted styling. Retain the widget fallback for older Pi hosts.
- Request 1–2 sentences and at most 300 characters in the default Summary prompt.
- Add `Ctrl+Alt+G` and `/rarebit got-it` to persist branch-local recap read
  checkpoints. Subsequent summaries emphasize changes beyond recap coverage.
- Include a native fullscreen renderer probe documenting Pi 0.84.2's mouse-input
  limitation; the read affordance currently supports keyboard activation.

## 0.2.0 — 2026-09-27

- Add the `/rarebit` action palette and tabbed `/rarebit settings` editor.
- Add a configurable `summary_prompt` for Summary format and length. Preserve
  paragraphs and bullets; reject oversized output instead of silently cutting it.
- Show the complete Recap in a muted, labelled TUI section. Remove
  `/rarebit recap expand`.
- Keep Recap outside Session messages and model context. Typing preserves it;
  submitted input, new turns, and Session or branch changes clear it.
- Default Summary diagnostics to off, support host or explicit IANA timezones,
  and expose the estimated Summary input budget in settings.
- Include a complete example config in `docs/examples/rarebit.settings.json`.

## 0.1.0-alpha.6 — 2026-09-21

- Add bounded `/rarebit fork` and CLI fork flows with native Pi headroom checks.
- Add PiQ read-only recovery, machine-only lineage, repeat-fork ancestry, and
  activity exclusion for imported entries.
- Keep read-only package commands usable without optional Pi host peers; fork
  runtime loads the Pi adapter only when needed.

## 0.1.0-alpha.5 — 2026-08-16

- Repair Pi 0.84.2 Summary calls to use the active Pi model runtime. The
  injected Pi AI completion path remains the Pi 0.83.0 fallback.
- Declare the unbounded Pi AI peer range from Pi 0.83.0. The release gate runs
  Recall against Pi 0.83.0 and Pi 0.84.2.

Published through GitHub Actions OIDC to npm `next`; `latest` remains alpha.4.
The exact source, package, registry, provenance, and GitHub prerelease evidence
is in the [alpha.5 release receipt](release/v0.1.0-alpha.5-release-receipt.md).

## 0.1.0-alpha.4 — 2026-08-02

Alpha.4 is a new artifact with a sanitized current source lineage and unchanged
product capability from the alpha.3 cutoff tree `db7d388`. The old tag graphs
remain public and are not privacy-clean. All existing alpha.1, alpha.2, and
alpha.3 tags, releases, and npm artifacts remain immutable (there is no alpha.1
GitHub Release). Alpha.3 remains the original readable-Recall release. Intended
npm routing after publication is `next=alpha.4` and `latest=alpha.4`.
The source-only machine-readable candidate derivation and vendored-scanner
binding is [`release/privacy-lineage.v1.json`](release/privacy-lineage.v1.json).
It is excluded from npm and does not claim publication completion.

This release changes only version and release documentation; runtime behavior
and readable Markdown Recall are unchanged.

## 0.1.0-alpha.3 — 2026-08-02

- Recall now sends one human-readable Markdown user message with the exact request and local private JSON evidence references. Idle and busy steer behavior remains unchanged, and JSON files remain machine authority.

## 0.1.0-alpha.2 — 2026-08-02

First promoted OIDC prerelease candidate. This corrective release has no
product or runtime behavior change from alpha.1. It prepares the standalone
package for non-destructive trusted publication.

## 0.1.0-alpha.1 — 2026-08-02

Bootstrap registry evidence. It preserves the committed Rarebit source from
HyperCarrier commit `945533d41e6c1f88718d12b744bc96202afbac21`. The package
name is `@hypercarrier/rarebit` and the CLI is `rarebit`.

This is an unstable alpha. Public APIs, CLI output, sidecar details, and visual
marks can change before a stable release.
