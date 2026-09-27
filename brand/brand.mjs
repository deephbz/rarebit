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

export const tokens = freeze({
  colors: freeze({
    paper: "#f6f3ed",
    paperBright: "#fffdf8",
    ink: "#17211b",
    muted: "#5d6a63",
    faint: "#dfe5df",
    rule: "#cbd5ce",
    user: "#15803d",
    continuation: "#2563eb",
    boundary: "#334155",
    diagnostic: "#b91c1c",
    attention: "#9a3412",
    attentionWash: "#fff7ed",
    dark: "#102119",
    darkRaised: "#183127",
    darkText: "#edf6ef",
  }),
  fonts: freeze({
    display: "'Lora', Georgia, 'Times New Roman', serif",
    body: "'Source Sans 3', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'Source Code Pro', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  }),
  radius: freeze({
    small: 8,
    medium: 18,
    large: 28,
  }),
  spacing: freeze({
    unit: 8,
    contentMax: 1160,
  }),
});

export const copy = freeze({
  name: "Rarebit",
  eyebrow: "A calmer way back into the work",
  headline: "Catch up on long Pi sessions without rereading the tool traffic.",
  shortDescription:
    "Rarebit selects conversational prose on the active branch so you can recover the thread, decide what matters, and continue.",
  cta: "See how it works",
  install: "pi install npm:@hypercarrier/rarebit@0.2.0",
  journeys: freeze([
    freeze({
      name: "Catch up",
      label: "Distill",
      text: "Extract the selected conversation from an exact Session path. No model is needed.",
      command: "npx --package @hypercarrier/rarebit@0.2.0 rarebit extract --session <path-or-session-id> --json",
    }),
    freeze({
      name: "Recall",
      label: "Give context back",
      text: "Rarebit writes the selection to private local files and sends Pi one request that points the agent to them. Your model provider sees what the agent reads.",
      command: "/rarebit recall <prompt>",
    }),
    freeze({
      name: "Fork",
      label: "Start clean",
      text: "Start a new Session from the newest selected prose. It does not promise complete context transfer.",
      command: "/rarebit fork",
    }),
  ]),
  claims: freeze([
    freeze({
      text: "Selection is deterministic and keeps source-entry lineage.",
      anchor: "src/rarebit-core.mjs:selectRarebits",
    }),
    freeze({
      text: "Native Pi Session JSONL remains the evidence authority.",
      anchor: "README.md#privacy-and-local-data",
    }),
    freeze({
      text: "Tool inputs, tool results, and hidden reasoning stay out of Rarebits.",
      anchor: "src/rarebit-core.mjs:rarebitMetadata",
    }),
    freeze({
      text: "Summary and Title are optional model-derived projections.",
      anchor: "README.md#configure-optional-derivations",
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
