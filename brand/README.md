# Rarebit brand source

Purpose: provide one presentation source for the README banner, public site, SVG assets, and promo video.
Scope: brand tokens, short public copy, claim anchors, semantic marks, and renderer-neutral drawing primitives. Runtime selection and Summary semantics remain in `../src/`.
Status: active collateral source for the Rarebit public alpha.

## Build

Run from the Rarebit repository root after a clean clone:

```sh
npm ci
npm ci --prefix brand
node brand/build-assets.mjs --check
node brand/build-assets.mjs --site
node brand/build-assets.mjs --check
```

`--check` verifies tracked assets on a clean clone. After `--site`, it also
checks the ignored Pages output. `--site` writes deterministic assets, fonts,
token data, generated HTML copy, and a disabled video config to `brand/site/`; that output is
regenerated in CI and is not part of the source bundle. The template owns the
HTML copy; the build injects `RarebitBrand.copy` values before writing the
Pages output. Use `node brand/build-assets.mjs --site --with-video` only after
the release MP4 has been uploaded and reviewed. The default site omits the
video and transcript, with no broken remote source. The README banner is always
`brand/assets/banner.svg`.

## Shared API

```js
import { RarebitBrand } from "./brand/brand.mjs";

RarebitBrand.tokens;             // palette, font roles, spacing
RarebitBrand.copy;               // short copy and source-backed claims
RarebitBrand.drawMark(ctx, kind, x, y, size);
RarebitBrand.drawLogo(ctx, x, y, size);
```

`kind` is one of `user_message`, `agent_continuation`, `agent_stop`, or
`terminal_error`. The module imports these roles from
`src/rarebit-visual-language.mjs`; it does not define a second semantic map.
The drawing methods use the Canvas2D subset needed by the SVG asset adapter and
Canvas video renderer. They use center coordinates.

- `drawMark`: `x` and `y` are the mark center. `size` is the square side or
  nominal diameter. Continuation dots render at `0.27 * size`; stop circles
  render at `0.52 * size`.
- `drawLogo`: `x` and `y` are the center of a three-mark sequence. Marks sit at
  `x - 0.42 * size`, `x`, and `x + 0.42 * size`; the connecting rule stays
  behind them. The default size is `48`.

The visual meaning comes from `VISUAL-LANGUAGE.md` and the executable mapping.
Color never carries meaning alone. Layout belongs to each surface.

## Public claim rule

Use `RarebitBrand.copy.claims` when writing new public short copy. Each claim
has a source anchor. Say **selected prose on the active branch**. Do not imply
whole-session memory, universal ratios, complete context transfer, verified
delivery, or measured user benefit.

The site video is optional. It uses a release URL, `preload="none"`, controls,
and an equivalent transcript so the product story does not depend on motion or
sound.
