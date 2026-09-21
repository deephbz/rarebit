# Changelog

## 0.1.0-alpha.6 — 2026-09-21

- Add bounded `/rarebit fork` and CLI fork flows with native Pi headroom checks.
- Add PiQ read-only recovery, machine-only lineage, repeat-fork ancestry, and
  activity exclusion for imported entries.
- Keep read-only package commands usable without optional Pi host peers; fork
  runtime loads the Pi adapter only when needed.

This is an unpublished release candidate. Intended npm routing after
publication is `next=alpha.6`; `latest` remains `alpha.4`.

## 0.1.0-alpha.5 — 2026-08-16

- Repair Pi 0.84.2 Summary calls to use the active Pi model runtime. The
  injected Pi AI completion path remains the Pi 0.83.0 fallback.
- Declare the unbounded Pi AI peer range from Pi 0.83.0. The release gate runs
  Recall against Pi 0.83.0 and Pi 0.84.2.

Alpha.5 was published on the `next` dist-tag. The `latest` dist-tag remains
`alpha.4`.

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
