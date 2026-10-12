// Preview helper: map a Claude Code transcript to a Pi-shaped active branch,
// run the unchanged Rarebit core selector, and print JSON for the mod.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { measureRarebits, selectRarebits } from "../../src/rarebit-core.mjs";
import {
  RAREBIT_CONVERSATION_SCHEMA_VERSION,
  RAREBIT_RECALL_SCHEMA_VERSION,
  materializeRarebitRecall,
} from "../../src/rarebit-recall.mjs";

const STOP = { end_turn: "stop", stop_sequence: "stop", tool_use: "toolUse", max_tokens: "length" };
const HARNESS_WRAPPER = /^\s*<(command-name|command-message|local-command-stdout|local-command-caveat|bash-input|bash-stdout|task-notification)>/;

function resolveTranscript(arg) {
  if (arg.endsWith(".jsonl")) return arg;
  const root = join(homedir(), ".claude", "projects");
  for (const d of readdirSync(root)) {
    const f = join(root, d, `${arg}.jsonl`);
    if (existsSync(f)) return f;
  }
  throw new Error(`no transcript for session ${arg}`);
}

function toolResultText(blocks) {
  return blocks
    .map((b) => (typeof b.content === "string" ? b.content : (b.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n")))
    .join("\n");
}

const textChars = (m) =>
  typeof m?.content === "string" ? m.content.length : (m?.content ?? []).reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);

// Active branch across compactions: parentUuid, else logicalParentUuid at a
// compact boundary. Compaction markers stay in the branch; the core ignores
// non-message entries. Claude Code can append a row again under the same uuid
// with a later parent; the first copy keeps the original link, and the walk
// stops at any revisited uuid.
export function claudeCodeActiveBranch(text) {
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byUuid = new Map();
  let leaf = null;
  for (const r of rows) {
    if (r.uuid && !byUuid.has(r.uuid)) byUuid.set(r.uuid, r);
    if ((r.type === "user" || r.type === "assistant") && !r.isSidechain) leaf = r.uuid;
  }
  const chain = [];
  const seen = new Set();
  for (let u = leaf; u && byUuid.has(u) && !seen.has(u); u = byUuid.get(u).parentUuid ?? byUuid.get(u).logicalParentUuid) {
    seen.add(u);
    chain.push(byUuid.get(u));
  }
  chain.reverse();
  const branch = [];
  const open = new Map();
  for (const r of chain) {
    if (r.type === "system" && r.subtype === "compact_boundary") {
      branch.push({ type: "compaction", id: r.uuid, timestamp: r.timestamp });
      continue;
    }
    if (r.type !== "user" && r.type !== "assistant") continue;
    if (r.isCompactSummary) {
      branch.push({ type: "summary", id: r.uuid, chars: textChars(r.message) });
      continue;
    }
    if (r.isMeta) continue;
    const m = r.message ?? {};
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
    if (content.some((b) => b.type === "text" && HARNESS_WRAPPER.test(b.text))) continue;
    const results = content.filter((b) => b.type === "tool_result");
    if (results.length) {
      branch.push({ type: "message", id: r.uuid, timestamp: r.timestamp, message: { role: "toolResult", content: [{ type: "text", text: toolResultText(results) }] } });
      continue;
    }
    if (r.type === "assistant" && m.id && open.has(m.id)) {
      const e = open.get(m.id);
      e.message.content.push(...content);
      e.message.stopReason = STOP[m.stop_reason] ?? m.stop_reason ?? e.message.stopReason;
      continue;
    }
    const e = { type: "message", id: r.uuid, timestamp: r.timestamp, message: { role: m.role, content: [...content], stopReason: STOP[m.stop_reason] ?? m.stop_reason } };
    if (r.type === "assistant" && m.id) open.set(m.id, e);
    branch.push(e);
  }
  return branch;
}

// Copied from the Pi extension's recallMessage (src/extension.mjs) for the
// preview; the SSOT refactor moves it into rarebit-recall.mjs.
function fence(value) {
  const longest = (ch) => Math.max(3, ...(String(value).match(ch === "`" ? /`+/g : /~+/g) ?? []).map((r) => r.length + 1));
  const marker = longest("`") <= longest("~") ? "`" : "~";
  const boundary = marker.repeat(longest(marker));
  return `${boundary}text\n${value}\n${boundary}`;
}

function recallMessage(recall, requestText) {
  return `# Rarebit Recall

*Answer the **Current request** below. Use these local private files to recover earlier context from this Session.*

## Files

**Conversation** — \`rarebit_conversation/v${RAREBIT_CONVERSATION_SCHEMA_VERSION}\`. Read this first.

${fence(recall.conversationPath)}

**Detailed evidence** — \`rarebit_message_recall/v${RAREBIT_RECALL_SCHEMA_VERSION}\`. Use it only for source, Session, branch, or lineage facts. Join on \`seq\`.

${fence(recall.detailedPath)}

## Conversation schema

\`\`\`text
{ messageCount, lastRound, messages: [{ seq, round, role, kind, time, text }] }
seq    1-based, oldest first
round  increments at each user message; agent messages before the first user message have round 0
role   "user" | "agent"
kind   "request" (user) | "progress" (agent text before a tool call) | "reply" (agent final answer)
time   UTC "YYYY-MM-DDTHH:MM:SSZ", or null
\`\`\`

Messages contain user and agent text only. Tool calls and tool results are excluded.

## Example queries

Set \`F\` to the Conversation path. Read the smallest slice that answers the request.

\`\`\`sh
jq '.messages[-20:]' "$F"                                              # last 20 messages
jq '[.messages[] | select(.role == "user")][-3:]' "$F"                 # last 3 user messages
jq '[.messages[] | select(.kind == "reply")][-10:]' "$F"               # last 10 agent replies
jq '.lastRound as $r | [.messages[] | select(.round > $r - 5)]' "$F"  # last 5 rounds
jq '(now - 8*3600 | todate) as $t | [.messages[] | select(.time >= $t)]' "$F"  # last 8 hours
\`\`\`

## Current request

${fence(requestText)}`;
}

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : null);

const [cmd, id, ...rest] = process.argv.slice(2);
const t0 = performance.now();
const transcript = resolveTranscript(id);
const branch = claudeCodeActiveBranch(readFileSync(transcript, "utf8"));
const sel = selectRarebits(branch);
const m = measureRarebits(branch, sel);
const ms = Math.round(performance.now() - t0);
const byOrder = new Map(sel.occurrences.map((o) => [o.order, o]));
const items = [];
branch.forEach((entry, order) => {
  if (entry.type === "compaction") {
    if (items.length) items.push({ kind: "compaction", time: clock(entry.timestamp) });
    return;
  }
  const o = byOrder.get(order);
  if (o) items.push({ kind: o.role === "user" ? "user" : o.outcome, time: clock(o.timestamp), text: o.text });
});
// Diagnosis breakdown: chars by kind, the same ceil(chars / 4) estimate as the
// core. Rarebit kinds come from the selection; "other" is the prose it left.
function breakdown(from) {
  const c = { user: 0, continuation: 0, stop: 0, toolCalls: 0, toolResults: 0, thinking: 0, summary: 0, other: 0 };
  branch.forEach((entry, order) => {
    if (order < from) return;
    if (entry.type === "summary") return void (c.summary += entry.chars);
    if (entry.type !== "message") return;
    const m = entry.message;
    if (m.role === "toolResult") return void (c.toolResults += textChars(m));
    for (const b of m.content) {
      if (b.type === "thinking") c.thinking += (b.thinking ?? "").length;
      else if (b.type === "tool_use") c.toolCalls += b.name.length + JSON.stringify(b.input ?? {}).length;
    }
    const o = byOrder.get(order);
    const prose = textChars(m);
    const picked = o ? Math.min(prose, o.text.length) : 0;
    if (o) c[o.role === "user" ? "user" : o.outcome] += picked;
    c.other += prose - picked;
  });
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.ceil(v / 4)]));
}

const stats = { ratio: m.rarebitRatio, rarebitTokens: m.estimatedRarebitTokens, totalTokens: m.estimatedTotalTokens };

if (cmd === "select") {
  console.log(JSON.stringify({ items, ...stats }));
} else if (cmd === "diagnosis") {
  const count = (k) => items.filter((x) => x.kind === k).length;
  let lastCompaction = 0;
  branch.forEach((entry, order) => { if (entry.type === "compaction") lastCompaction = order; });
  console.log(JSON.stringify({
    ms, branch: branch.length, user: count("user"), continuation: count("continuation"), stop: count("stop"), compactions: count("compaction"), ...stats,
    session: breakdown(0), live: breakdown(lastCompaction),
  }));
} else if (cmd === "recall") {
  // The core's own Recall bundle, fed a Pi-shaped context over the CC branch.
  // Preview: evidenceAuthority still reads "pi_session_jsonl".
  const ctx = { sessionManager: { getSessionFile: () => transcript, getHeader: () => ({ id }), getBranch: () => branch } };
  const recall = await materializeRarebitRecall(ctx);
  console.log(JSON.stringify({ count: recall.selectedMessageCount, message: recallMessage(recall, rest.join(" ")) }));
} else {
  console.error("usage: rarebit-cc.mjs select|diagnosis|recall <session-id|path>");
  process.exit(2);
}
