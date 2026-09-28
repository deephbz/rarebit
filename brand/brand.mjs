import {
  RAREBIT_EVENT_PRESENTATION,
  RAREBIT_SUMMARY_PRESENTATION,
} from "../src/rarebit-visual-language.mjs";

/**
 * Rarebit's shared presentation source.
 *
 * Purpose: give the README, static site, SVG assets, and promo renderer one
 * source for brand tokens, public copy, and semantic marks.
 * Scope: presentation only. Selection, status meaning, and Pi behavior stay
 * in the package source linked below.
 */

const freeze = (value) => Object.freeze(value);

// Paperback Chic: an aged-paper page, warm ink, one cheddar cover band, and
// book typography. Information hygiene: generous margins, one focal line at a
// time, and noise filed as footnotes instead of deleted. Event-mark colors
// (user, continuation, boundary, diagnostic) keep their semantic values.
export const tokens = freeze({
  colors: freeze({
    paper: "#efe6d3",
    paperBright: "#faf5ea",
    ink: "#211c16",
    muted: "#6b6255",
    faint: "#e3d8c2",
    rule: "#cdbfa3",
    cover: "#d9912b",
    highlight: "#f2c96f",
    user: "#15803d",
    continuation: "#2563eb",
    boundary: "#334155",
    diagnostic: "#b91c1c",
    attention: "#9a3412",
    attentionWash: "#fff7ed",
    dark: "#231e18",
    darkRaised: "#302922",
    darkText: "#f4ecdc",
  }),
  fonts: freeze({
    display: "'EB Garamond', Garamond, 'Times New Roman', serif",
    body: "'EB Garamond', Garamond, Georgia, serif",
    label: "'Jost', Futura, 'Century Gothic', 'Avenir Next', sans-serif",
    mono: "'Courier Prime', 'Courier New', Courier, monospace",
  }),
  radius: freeze({
    small: 2,
    medium: 4,
    large: 6,
  }),
  spacing: freeze({
    unit: 8,
    contentMax: 1120,
    measure: 34,
  }),
});

export const copy = freeze({
  name: "Rarebit",
  eyebrow: "A Pi extension for long sessions",
  headline: "Keep the rare bits of a long Pi session.",
  shortDescription:
    "Rarebit picks out your messages and the agent’s prose replies. Those few lines carry your intent, the progress, and where the agent stopped. Tool traffic stays out, and the source session stays untouched.",
  tagline: "Keep the rare bits. Leave the traffic.",
  cta: "See how it works",
  install: "pi install npm:@hypercarrier/rarebit@0.2.0",
  extract: "npx --package @hypercarrier/rarebit@0.2.0 rarebit extract --session <path-or-session-id> --json",
  journeys: freeze([
    freeze({
      name: "Recall",
      label: "Remind the agent",
      text: "Hand the rare bits back to the agent before its next turn. Rarebit writes them to private local files and sends one request that points the agent to them.",
      command: "/rarebit recall <request>",
    }),
    freeze({
      name: "Summary",
      label: "Catch up yourself",
      text: "Ask your model for a short Summary of the rare bits, then read it in Pi with Recap. Summary is optional and needs a configured model.",
      command: "/rarebit summarize",
    }),
    freeze({
      name: "Fork",
      label: "Start fresh",
      text: "Start a new session from the newest rare bits that fit a size budget, with the tool calls left behind. It does not promise complete context transfer.",
      command: "/rarebit fork",
    }),
  ]),
  claims: freeze([
    freeze({
      text: "Selection is deterministic and keeps source-entry lineage.",
      anchor: "src/rarebit-core.mjs:selectRarebits",
    }),
    freeze({
      text: "The native Pi session JSONL remains the evidence authority.",
      anchor: "README.md#privacy-and-local-data",
    }),
    freeze({
      text: "Tool inputs, tool results, and hidden reasoning stay out of the rare bits.",
      anchor: "src/rarebit-core.mjs:rarebitMetadata",
    }),
    freeze({
      text: "Summary and Title are optional model-derived projections.",
      anchor: "README.md#configure-optional-derivations",
    }),
    freeze({
      text: "Recall writes private local files and sends Pi one request that points the agent to them.",
      anchor: "README.md#2-recall-for-the-agent",
    }),
    freeze({
      text: "Fork seeds a new session from a bounded newest suffix of selected prose.",
      anchor: "README.md#3-fork-as-a-distilled-native-fork",
    }),
  ]),
});

const eventColors = freeze({
  user_message: tokens.colors.user,
  agent_continuation: tokens.colors.continuation,
  agent_stop: tokens.colors.boundary,
  terminal_error: tokens.colors.diagnostic,
});

const eventPresentation = freeze({
  user_message: RAREBIT_EVENT_PRESENTATION.user_message,
  agent_continuation: RAREBIT_EVENT_PRESENTATION.agent_continuation,
  agent_stop: RAREBIT_EVENT_PRESENTATION.agent_stop,
  terminal_error: RAREBIT_EVENT_PRESENTATION.terminal_error,
});

function assertCanvasContext(ctx) {
  if (!ctx || typeof ctx.beginPath !== "function") {
    throw new TypeError("A Canvas2D-compatible drawing context is required");
  }
}

function drawSquare(ctx, x, y, size, color) {
  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.11);
  ctx.beginPath();
  ctx.rect(x - size / 2, y - size / 2, size, size);
  ctx.stroke();
  ctx.restore?.();
}

function drawCircle(ctx, x, y, radius, color, fill = true) {
  ctx.save?.();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  fill ? ctx.fill() : ctx.stroke();
  ctx.restore?.();
}

function drawCross(ctx, x, y, size, color) {
  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size / 2, y - size / 2);
  ctx.lineTo(x + size / 2, y + size / 2);
  ctx.moveTo(x + size / 2, y - size / 2);
  ctx.lineTo(x - size / 2, y + size / 2);
  ctx.stroke();
  ctx.restore?.();
}

/** Draw one canonical Rarebit event mark. */
export function drawMark(ctx, kind, x, y, size = 16) {
  assertCanvasContext(ctx);
  if (!eventPresentation[kind]) throw new TypeError(`Unknown Rarebit mark: ${kind}`);
  const color = eventColors[kind];
  if (kind === "user_message") drawSquare(ctx, x, y, size, color);
  else if (kind === "agent_continuation") drawCircle(ctx, x, y, size * 0.27, color);
  else if (kind === "agent_stop") drawCircle(ctx, x, y, size * 0.52, color);
  else drawCross(ctx, x, y, size * 0.82, color);
}

/** Draw the compact mark sequence used by the Rarebit icon. */
export function drawLogo(ctx, x, y, size = 48) {
  assertCanvasContext(ctx);
  const gap = size * 0.42;
  const unit = size * 0.34;
  ctx.save?.();
  ctx.strokeStyle = tokens.colors.rule;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath();
  ctx.moveTo(x - gap, y);
  ctx.lineTo(x + gap, y);
  ctx.stroke();
  ctx.restore?.();
  drawMark(ctx, "user_message", x - gap, y, unit);
  drawMark(ctx, "agent_continuation", x, y, unit);
  drawMark(ctx, "agent_stop", x + gap, y, unit);
}

export const RarebitBrand = freeze({
  tokens,
  copy,
  marks: eventPresentation,
  summaryStatuses: RAREBIT_SUMMARY_PRESENTATION,
  drawMark,
  drawLogo,
});

export default RarebitBrand;
