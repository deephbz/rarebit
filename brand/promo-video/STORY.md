# Rarebit promo video: Paperback Chic cut

Status: published 2026-09-28 as `rarebit-promo.mp4` on the v0.2.0 release
(62.4 s, SHA-256 `e40bd485…ad2ce6`), after owner review.

## Source of the scenes

The session content restages a real demo run, not an invented trace. A Pi
session in a throwaway repository fixed a pagination cache bug; Rarebit then
ran on it. Observed: 51 session entries, 28 tool calls and results, 6 selected
rare bits (`rarebit extract`); `/rarebit recall` posted one "Rarebit Recall"
request with two file pointers, the agent read `rarebit-conversation.json` and
answered; `/rarebit fork` opened a "Resumed session" with prose only, context
6.3% → 0.3% of 272k. Summary was `ineligible` for this short session, so the
Recap text in chapter III is labelled illustrative. The Pi TUI structure (tinted
user blocks, `$` tool rows, dim output, `ctrl+o to expand`, TPS lines, the
Recap panel between rules, the status line) comes from live pane captures.

## Governance envelope

- **Purpose:** show Pi users that Rarebit keeps the rare bits of a long session,
  and what those bits are for.
- **Invariants:** canonical Rarebit marks only on the selected lines; the source
  stays visible as a kept pile; a stop is not shown as success; Summary is
  labelled optional and model-written; Fork makes no complete-context claim;
  demo numbers are labelled as this demo session.
- **Non-goals:** CLI demonstration, universal ratios, time savings, perfect memory.

## One book

| Time | Beat | Visible cause |
|---|---|---|
| 0–6 | A demo Pi transcript scrolls. | scroll |
| 6–8 | Pull back: the whole session on one page. | camera |
| 8–20.6 | Hero: the RAREBIT sieve sweeps down; tool rows fall through as sand into a kept pile; six rare bits catch (a neutral ring pulse; cheddar never marks an event) and gather into clean text. | sieve |
| 20.6–27.4 | Highlights: intent, progress, where it stopped. "51 entries in, 6 rare bits out." | highlighter |
| 27.4–37.4 | II Recall, restaged Pi TUI. | `/rarebit recall …` |
| 37.4–45.4 | III Recap panel. | Summary triggered |
| 45.4–54.4 | IV Fork: rare bits copy into a new session; context 6.3% → 0.3%. | `/rarebit fork` |
| 54.4–62.4 | Cover and install line. | page turn |

## Build and checks

```sh
npm ci
npm run budget      # reading holds
npm run audit       # every visible read ≥ 40 px body, ≥ 32 px label
npm run stills
npm run build       # music, frames, encode → out/rarebit-promo.mp4
```

Needs Google Chrome and ffmpeg. Result for `pb3`: 30 reads, 0 short; 250 audit
samples, smallest read 32 px, 0 violations; 1872 frames, 62.4 s, H.264 with
AAC. Stills and transitions were inspected; human aesthetic acceptance is
pending.
