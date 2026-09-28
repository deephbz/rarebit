# Rarebit brand brief

Purpose: explain Rarebit to Pi users who need to recover the thread of a long session.
Scope: shared brand assets, README, public website, and a reproducible promo video. Runtime behavior and evidence semantics remain unchanged.
Status: implementation brief. Product direction is accepted; visual execution uses delegated maintainer judgment.

## Product story

**Keep the rare bits of a long Pi session.**

The name is the story: Rarebit keeps the *rare bits*. It distills the active session branch into the user messages and the agent's prose replies. Those few lines carry the user's intent, the progress, and where the agent stopped. Tool traffic stays out; the original session remains the evidence. The metaphor is distillation: diamonds kept, sand sifted away and kept as the source.

Use this hierarchy:

1. Catch up / distill: the core story. Lead with the rare bits, not with a command.
2. Uses of the rare bits, shown as equal chapters:
   - Recall: remind the agent. The Pi slash command prepares the selection for one request.
   - Summary: catch up yourself. An optional model-derived projection; Recap presents an existing Summary in the Pi TUI.
   - Fork: start fresh. A new session from a bounded newest suffix of selected prose, tool calls left behind.
3. CLI `extract`: a secondary path for scripts and agent workflows.

Keep commands quiet. Show at most one short slash command per use; keep long CLI lines out of the first screen and out of the video's core story.

Do not describe deterministic selection as model summarization. Do not invent a CLI `recall` command; show the actual `extract` interface. Summary generation needs a configured model. Displaying Recap does not generate a Summary. Fork does not promise complete context transfer.

## Audience and proof

The primary audience uses Pi and returns to long sessions after interruptions. Show one familiar terminal session before introducing technical vocabulary. The core scenario is: return, recover the conversation, then choose a next action.

Use an explicitly illustrated, fictional session in public graphics. Suggested prose:

- User: “Keep the public API unchanged.”
- Agent continuation: “I’ll check the cache key.”
- Agent stop: “Cache fix ready for review.”

Keep source evidence visually reachable. Tool traffic can recede, but the animation must not imply deletion. Stop marks must not imply verified success. End the core journey with an explicit next decision, such as inspecting the patch before acceptance. Recall supplies file pointers; show the agent reading them before using the conversation.

Every product claim must cite its package source, test, or user documentation. A claim anchor establishes behavior; it does not establish a measured user benefit. Do not claim a universal 1% ratio, percentage savings, faster model inference, perfect memory, complete context transfer, or verified delivery. External fleet and trace applications are not bundled Rarebit features.

## Shared visual source

Use the existing executable event grammar in `src/rarebit-visual-language.mjs` and perceptual intent in `VISUAL-LANGUAGE.md`. Keep its meaning unchanged:

- hollow green square: user message;
- smaller blue dot: agent continuation;
- larger slate circle: agent stop;
- red cross: terminal error, outside Rarebit selection.

Summary status is a separate as-of annotation. Do not turn it into an event or use green as a success signal.

Brand direction: **Paperback Chic** with an information-hygiene feel. An aged-paper page, warm ink, EB Garamond prose, tracked Jost capitals for the wordmark and running heads, Courier Prime for session text, and one cheddar cover band as the only decorative accent. Hygiene: generous margins, one focal line at a time, noise filed as footnotes or kept as a source pile instead of deleted, and every claim footnoted to its source. Avoid copying another product's palette, actor colors, or heavy outlines. Color never carries meaning alone; cheddar never marks an event.

`brand/brand.mjs` owns brand tokens, public short copy, claim anchors, and shared drawing primitives. It imports the executable semantic mapping instead of redefining it. Generated SVG assets, the website, and Canvas video frames derive from this source. Layout belongs to each surface.

The builder publishes a small interface for video integration:

```js
import { RarebitBrand } from '../brand.mjs';
// RarebitBrand.tokens: color and font tokens
// RarebitBrand.copy: shared public short copy and source-backed claims
// RarebitBrand.drawMark(ctx, kind, x, y, size)
// RarebitBrand.drawLogo(ctx, x, y, size)
```

The `ctx` drawing interface should work for Canvas2D and the SVG asset renderer. The brand README documents exact coordinates and sizes. The video builder may add local layout helpers, but must not fork palette, logo, typography, or semantic marks.

## Surface jobs

- README: understand the value, install, and achieve the first useful result. Preserve configuration, privacy, compatibility, and recovery guidance with clear navigation.
- GitHub Pages: a compact product introduction with a visible demonstration, the three journeys, installation, source links, and accessible mobile layout.
- Promo video: show the distillation (traffic sifts away, rare bits remain), then Recall, Summary, and Fork as chapters of one book.

The site needs no analytics, external tracking, accounts, backend, or live private session data. Use vendored licensed fonts or safe system fonts. Respect reduced motion and keyboard access.

## Video defaults

- 1920 × 1080, 30 fps, approximately 60–75 seconds.
- Body text at least 40 px and labels at least 32 px at 1080p; `render.mjs --audit` checks every visible read.
- Works without sound; optional deterministic, sample-free music.
- One timeline owns scene timing, captions, reading holds, and audio cues.
- Every frame is a pure function of time. Load fonts before rendering.
- Keep captions near the action. Use one focal group at a time.
- Transitions retain a visible anchor. Content changes have a visible cause.
- Check reading time by script: 0.2 seconds per word plus 2 seconds recognition, or 3 seconds at 10 or more words.
- Keep source under `brand/promo-video/`; ignore generated frames, audio, renders, and dependencies. Retain the final render outside Git history.

## Verification and publication

Verify a clean source build, generated-asset drift, documented commands, responsive and keyboard website behavior, video frame count/duration/audio peak, and representative stills including transitions. Inspect the actual rendered surfaces. Automated checks do not establish human aesthetic acceptance.

Hold video publication for human review of the rendered candidate. Obtain a fresh website review with `claude -p --model claude-opus-5-5` and resolve material findings before website handoff. Keep the public video embed disabled until a reviewed asset is available.

The source base is `a64dc5bc052569fdfd6b344cacfd986d68bbf248`. This is one independent collateral change. Do not alter runtime behavior, bump the npm version, or publish an npm artifact. Keep implementation in this repository. Public Git metadata uses the approved handle and noreply address. Scan the exact publication tip and keep audit output outside the repository.

Architecture impact: none. This work changes product presentation, not runtime authority, components, or data flow.
