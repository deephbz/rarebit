import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildRarebitForkPlan,
  createRarebitForkEntries,
  writeRarebitForkFile,
} from "./rarebit-fork.mjs";

/**
 * Rarebit BTW: a temporary side Pi Session beside the main Session.
 *
 * The main Session stays the authority. BTW writes a private snapshot of the
 * active branch to the OS temp directory, opens a Herdr split, and runs a
 * second Pi on that snapshot. By default the side Pi loads extensions as
 * usual and enables the parent's active tools. Read-only BTW enables only
 * read-only built-in tools and loads no extensions, skills, context files,
 * or MCP servers. Closing the side Pi deletes the snapshot.
 */

export const RAREBIT_BTW_MODES = Object.freeze(["full", "rarebits"]);
export const RAREBIT_BTW_PANE_LABEL = "rarebit-btw";
export const RAREBIT_BTW_READONLY_TOOLS = "read,grep,find,ls";

const execFileAsync = promisify(execFile);

function messageOf(entry) {
  return entry?.type === "message" ? entry.message : null;
}

/**
 * Drop the unfinished tail of a mid-turn snapshot: the first assistant
 * message whose tool calls have no results, and everything after it.
 */
export function completedBranchPrefix(branch) {
  const resultIds = new Set();
  for (const entry of branch) {
    const message = messageOf(entry);
    if (message?.role === "toolResult" && message.toolCallId) resultIds.add(message.toolCallId);
  }
  const cut = branch.findIndex((entry) => {
    const message = messageOf(entry);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return false;
    return message.content.some((part) => part?.type === "toolCall" && !resultIds.has(part.id));
  });
  return cut < 0 ? branch : branch.slice(0, cut);
}

/** Full mode: the active branch verbatim, under a new Session header. */
export function createFullBtwEntries({ header, sessionFile, cwd, branch, now = new Date() }) {
  const entries = completedBranchPrefix(branch);
  const sessionId = randomUUID();
  return {
    sessionId,
    header: {
      type: "session",
      version: header?.version ?? 3,
      id: sessionId,
      timestamp: now.toISOString(),
      cwd: resolve(cwd ?? header?.cwd ?? process.cwd()),
      parentSession: resolve(sessionFile),
    },
    entries,
    droppedTailEntries: branch.length - entries.length,
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function btwSystemPrompt({ mode, sourceFile, readonly = false }) {
  const history = mode === "rarebits"
    ? "This Session holds only the Rarebit messages of another Pi Session: user requests and final agent replies."
    : "This Session is a copy of another Pi Session's active branch.";
  return [
    "## BTW side chat",
    history,
    "The user asks quick side questions about that history while the original agent keeps working.",
    "- Answer from the history. Be brief.",
    readonly
      ? "- Do not continue the original task. Do not modify files."
      : "- Do not continue the original task unless the user asks.",
    `- For detail the history omits, search the source Session JSONL with grep or read: ${sourceFile}`,
  ].join("\n");
}

function toolArguments({ readonly, activeTools }) {
  if (readonly) return [
    "--tools", RAREBIT_BTW_READONLY_TOOLS,
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp",
  ];
  if (!Array.isArray(activeTools)) return [];
  return activeTools.length > 0 ? ["--tools", activeTools.join(",")] : ["--no-tools"];
}

/** The argv for the side Pi. */
export function btwPiArguments({ sessionFile, model, thinking, readonly = false, activeTools, systemPrompt, question, name }) {
  return [
    "--session", sessionFile,
    ...(model?.provider && model?.id ? ["--model", `${model.provider}/${model.id}`] : []),
    ...(thinking ? ["--thinking", thinking] : []),
    ...toolArguments({ readonly, activeTools }),
    "--append-system-prompt", systemPrompt,
    ...(name ? ["--name", name] : []),
    ...(question ? ["--", question] : []),
  ];
}

/** A launcher that runs the side Pi, then deletes the snapshot and exits the pane shell. */
export function btwLauncherScript({ piCommand = "pi", piArguments, directory }) {
  return [
    "#!/bin/sh",
    `trap ${shellQuote(`rm -rf ${shellQuote(directory)}`)} EXIT`,
    "trap 'exit 129' HUP INT TERM",
    `${shellQuote(piCommand)} ${piArguments.map(shellQuote).join(" ")}`,
    "",
  ].join("\n");
}

/**
 * Write the snapshot and launcher. Returns paths and counts; the caller owns
 * `discard` until the launcher runs.
 */
export async function prepareRarebitBtw(ctx, {
  mode = "full",
  question = "",
  readonly = false,
  activeTools,
  model: configuredModel,
  thinking,
  tempRoot = tmpdir(),
  now = () => new Date(),
  piCommand = "pi",
} = {}) {
  if (!RAREBIT_BTW_MODES.includes(mode)) throw new Error(`unknown BTW mode ${mode}`);
  const sourceFile = ctx?.sessionManager?.getSessionFile?.();
  const branch = ctx?.sessionManager?.getBranch?.();
  const header = ctx?.sessionManager?.getHeader?.();
  if (typeof sourceFile !== "string" || !Array.isArray(branch))
    throw new Error("the current Pi Session must be persisted before BTW");
  // A configured BTW model carries its own optional `:thinking` suffix; the
  // parent model brings the parent thinking level.
  const model = configuredModel ?? ctx?.model ?? null;
  const sideThinking = configuredModel ? undefined : thinking;
  const directory = await mkdtemp(join(resolve(tempRoot), "hc-rarebit-btw-"));
  try {
    await chmod(directory, 0o700);
    let session;
    let summary;
    if (mode === "rarebits") {
      const plan = buildRarebitForkPlan({
        header, sessionFile: sourceFile, cwd: ctx.cwd, branch, targetCwd: ctx.cwd,
        maxTokenLength: Math.max(1, Math.floor((model?.contextWindow ?? ctx?.model?.contextWindow ?? 200_000) / 2)),
        targetModel: model, forkCreatedAt: now().toISOString(),
      });
      session = createRarebitForkEntries(plan);
      summary = `${plan.selected.length} Rarebit messages, ~${plan.importedTokens} tokens` +
        (plan.omittedOccurrences ? `, ${plan.omittedOccurrences} older omitted` : "");
    } else {
      session = createFullBtwEntries({ header, sessionFile: sourceFile, cwd: ctx.cwd, branch, now: now() });
      summary = `${session.entries.length} entries` +
        (session.droppedTailEntries ? `, ${session.droppedTailEntries} unfinished dropped` : "");
    }
    const sessionFile = join(directory, "session.jsonl");
    await writeRarebitForkFile(sessionFile, session);
    const piArguments = btwPiArguments({
      sessionFile, model, thinking: sideThinking, readonly, activeTools,
      systemPrompt: btwSystemPrompt({ mode, sourceFile: resolve(sourceFile), readonly }),
      question: String(question ?? "").trim(),
      name: `btw: ${mode}${readonly ? ", readonly" : ""}`,
    });
    const launcherPath = join(directory, "launch.sh");
    await writeFile(launcherPath, btwLauncherScript({ piCommand, piArguments, directory }), { mode: 0o700 });
    return {
      mode, readonly, directory, sessionFile, launcherPath, summary,
      model: model?.provider && model?.id ? `${model.provider}/${model.id}` : null,
      discard: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function herdrJson(herdrBin, args, run) {
  const { stdout } = await run(herdrBin, args, { timeout: 5_000 });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

/**
 * Open the side Pi in a Herdr split beside `paneId`. Another BTW pane already
 * open in the same tab is closed first, so each BTW starts from a fresh
 * snapshot. A BTW started inside a BTW pane keeps its own pane.
 */
export async function openRarebitBtwPane({
  launcherPath,
  cwd,
  paneId = process.env.HERDR_PANE_ID,
  herdrBin = process.env.HERDR_BIN_PATH || "herdr",
  direction = "right",
  ratio = 0.45,
  run = execFileAsync,
} = {}) {
  if (!paneId) throw new Error("BTW needs Herdr: HERDR_PANE_ID is not set");
  const current = await herdrJson(herdrBin, ["pane", "get", paneId], run);
  const tabId = current?.result?.pane?.tab_id;
  const listed = await herdrJson(herdrBin, ["pane", "list"], run);
  for (const pane of listed?.result?.panes ?? []) {
    if (pane.tab_id === tabId && pane.label === RAREBIT_BTW_PANE_LABEL && pane.pane_id !== paneId)
      await run(herdrBin, ["pane", "close", pane.pane_id], { timeout: 5_000 });
  }
  const split = await herdrJson(herdrBin, [
    "pane", "split", paneId, "--direction", direction, "--ratio", String(ratio),
    "--cwd", cwd, "--focus",
  ], run);
  const newPaneId = split?.result?.pane?.pane_id;
  if (!newPaneId) throw new Error("Herdr did not report the new pane");
  await run(herdrBin, ["pane", "rename", newPaneId, RAREBIT_BTW_PANE_LABEL], { timeout: 5_000 });
  await run(herdrBin, ["pane", "run", newPaneId, `exec sh ${shellQuote(launcherPath)}`], { timeout: 5_000 });
  return { paneId: newPaneId };
}

/**
 * Delete the snapshot once Herdr no longer reports the BTW pane. Herdr may
 * kill the pane before the launcher's EXIT trap runs, so cleanup follows
 * the pane's lifetime in a detached process that outlives both Pis.
 */
export function watchRarebitBtwPane({
  paneId,
  directory,
  herdrBin = process.env.HERDR_BIN_PATH || "herdr",
  intervalSeconds = 3,
  spawnImpl = spawn,
}) {
  const script = [
    `while [ -d ${shellQuote(directory)} ] && ${shellQuote(herdrBin)} pane get ${shellQuote(paneId)} >/dev/null 2>&1; do sleep ${Number(intervalSeconds)}; done`,
    `rm -rf ${shellQuote(directory)}`,
  ].join("; ");
  spawnImpl("sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
}
