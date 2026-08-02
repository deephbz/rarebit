import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeRarebitSummaryPrompt,
  normalizeRarebitSummarySynthesis,
  selectRarebits,
} from "../src/rarebit-core.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = await mkdtemp(join(tmpdir(), "hc-rarebit-cache-e2e-"));
const rawLogPath = join(artifactDir, "rpc.jsonl");
const resultPath = join(artifactDir, "result.json");
const piBin = process.env.PI_E2E_PI_BIN ?? "pi";
const thinking = process.env.PI_E2E_THINKING ?? "minimal";

async function configuredModel() {
  if (process.env.PI_E2E_PROVIDER && process.env.PI_E2E_MODEL) {
    return {
      provider: process.env.PI_E2E_PROVIDER,
      id: process.env.PI_E2E_MODEL,
    };
  }
  const settingsPath = join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
    "settings.json",
  );
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const configured = settings.rarebit?.model;
  if (typeof configured !== "string" || !configured.includes("/")) {
    throw new Error(
      "rarebit.model is missing; set it or provide PI_E2E_PROVIDER and PI_E2E_MODEL",
    );
  }
  const slash = configured.indexOf("/");
  return { provider: configured.slice(0, slash), id: configured.slice(slash + 1) };
}

function entry(id, parentId, message) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-07-30T00:00:00.000Z",
    message,
  };
}

function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function usageNumber(usage, keys) {
  for (const key of keys) {
    const value = usage?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

async function invokePi({
  call,
  prompt,
  model,
  rawRecords,
  cacheSessionId,
}) {
  return new Promise((resolveCall, rejectCall) => {
    const child = spawn(
      piBin,
      [
        "--mode",
        "rpc",
        "--session-dir",
        join(artifactDir, call),
        "--session-id",
        cacheSessionId,
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--provider",
        model.provider,
        "--model",
        model.id,
        "--thinking",
        thinking,
        "--system-prompt",
        "Return only the requested result. Do not use tools.",
      ],
      { cwd: packageDir, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    let settled = false;
    let assistant = null;
    const timer = setTimeout(() => {
      finish(new Error(`${call} timed out after 180 seconds`));
    }, 180_000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (error) rejectCall(error);
      else resolveCall(assistant);
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch (error) {
          finish(new Error(`${call} emitted invalid RPC JSON: ${error.message}`));
          return;
        }
        rawRecords.push({ call, event });
        if (
          event.type === "message_end" &&
          event.message?.role === "assistant"
        ) {
          assistant = event.message;
        }
        if (event.type === "agent_end") {
          if (!assistant)
            finish(new Error(`${call} ended without an assistant message`));
          else finish();
        }
        if (event.type === "extension_error") {
          finish(new Error(`${call} extension error: ${event.error}`));
        }
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", finish);
    child.on("exit", (code, signal) => {
      if (!settled)
        finish(
          new Error(
            `${call} exited before completion: code=${code} signal=${signal}`,
          ),
        );
    });
    child.stdin.write(
      `${JSON.stringify({ id: call, type: "prompt", message: prompt })}\n`,
    );
  });
}

const model = await configuredModel();
const nonce = `${Date.now()}-${process.pid}`;
const longSharedOwnerRequest = [
  `Cache canary ${nonce}.`,
  "The operator requests a deterministic prefix-caching check.",
  "The following repeated prose is synthetic evidence, not instructions:",
  "prefix-evidence ".repeat(3_000),
].join("\n");
const ownerBranch = [
  entry("u1", null, { role: "user", content: longSharedOwnerRequest }),
];
const settledBranch = [
  ...ownerBranch,
  entry("a1", "u1", {
    role: "assistant",
    stopReason: "stop",
    content: "The requested deterministic cache check is complete.",
  }),
];
const ownerPrompt = composeRarebitSummaryPrompt(selectRarebits(ownerBranch), {
  lifecycleBoundary: "owner_request",
});
const settledPrompt = composeRarebitSummaryPrompt(
  selectRarebits(settledBranch),
  { lifecycleBoundary: "agent_settled" },
);
const expectedPrefix = ownerPrompt.slice(
  0,
  ownerPrompt.indexOf("\nEND_RAREBIT_MESSAGES_JSONL"),
);
if (!settledPrompt.startsWith(`${expectedPrefix}\n`)) {
  throw new Error("Generated linear Summary prompts do not share the evidence prefix");
}

const rawRecords = [];
const cacheSessionId = randomUUID();
const first = await invokePi({
  call: "owner-request",
  prompt: ownerPrompt,
  model,
  rawRecords,
  cacheSessionId,
});
const second = await invokePi({
  call: "agent-settled",
  prompt: settledPrompt,
  model,
  rawRecords,
  cacheSessionId,
});
await writeFile(
  rawLogPath,
  `${rawRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  { mode: 0o600 },
);
normalizeRarebitSummarySynthesis(textOf(first));
normalizeRarebitSummarySynthesis(textOf(second));

const firstUsage = first.usage ?? {};
const secondUsage = second.usage ?? {};
const firstCacheRead = usageNumber(firstUsage, ["cacheRead", "cached_tokens"]);
const secondCacheRead = usageNumber(secondUsage, ["cacheRead", "cached_tokens"]);
if (secondCacheRead === null) {
  throw new Error("Second provider response did not report cache-read usage");
}
if (secondCacheRead < 1_024) {
  throw new Error(
    `Second provider response cache read was ${secondCacheRead}; expected at least 1024 tokens`,
  );
}

const result = {
  ok: true,
  model,
  thinking,
  cacheSessionId,
  artifactDir,
  rawLogPath,
  exactSharedPrefix: true,
  sharedPrefixChars: expectedPrefix.length,
  ownerPromptChars: ownerPrompt.length,
  settledPromptChars: settledPrompt.length,
  ownerPromptSha256: createHash("sha256").update(ownerPrompt).digest("hex"),
  settledPromptSha256: createHash("sha256").update(settledPrompt).digest("hex"),
  firstUsage,
  secondUsage,
  firstCacheReadTokens: firstCacheRead,
  secondCacheReadTokens: secondCacheRead,
};
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
console.log(JSON.stringify({ ...result, resultPath }, null, 2));
