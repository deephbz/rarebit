import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import registerPiRarebit from "../src/extension.mjs";

async function waitFor(predicate, label, timeout = 2_000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(`Timed out waiting for ${label}`);
    await delay(5);
  }
}

function expectedRecallMarkdown(conversationPath, detailedPath, request) {
  return `# Rarebit Recall

*Use these local private evidence files to recover historical context for this turn.*

## How to use this bundle

1. Treat **Current request** below as the exact current user request.
2. Read **Conversation** first for meaning.
3. Use **Detailed evidence** only for source, Session, branch, or lineage facts.
4. Answer the current request using this evidence.

## Local private evidence files

**Conversation** — \`rarebit_conversation/v1\`

\`\`\`text
${conversationPath}
\`\`\`

**Detailed evidence** — \`rarebit_message_recall/v1\`

\`\`\`text
${detailedPath}
\`\`\`

## Current request

\`\`\`text
${request}
\`\`\``;
}

function conversationPathFrom(message) {
  const match = message.match(
    /\*\*Conversation\*\* — `rarebit_conversation\/v1`\n\n```text\n([^\n]*rarebit-conversation\.json)\n```/,
  );
  assert.ok(match, "Recall Markdown must contain the fenced conversation path");
  return match[1];
}

function detailedPathFrom(message) {
  const match = message.match(
    /\*\*Detailed evidence\*\* — `rarebit_message_recall\/v1`\n\n```text\n([^\n]*rarebit-evidence\.json)\n```/,
  );
  assert.ok(match, "Recall Markdown must contain the fenced detailed path");
  return match[1];
}

const bundledPiRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@earendil-works/pi-coding-agent",
);
const root =
  process.env.PI_CODING_AGENT_ROOT ??
  bundledPiRoot;
const expectedPiVersion = process.env.RAREBIT_EXPECTED_PI_VERSION ?? "0.84.2";
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
assert.equal(
  packageJson.version,
  expectedPiVersion,
  `Pi ${expectedPiVersion} is required; found ${packageJson.version}`,
);
const pi = await import(pathToFileURL(join(root, "dist/index.js")).href);
const faux = await import(
  pathToFileURL(
    join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"),
  ).href
);

const temp = await mkdtemp(join(tmpdir(), "rarebit-pi0842-recall-"));
const sessions = join(temp, "sessions");
const manager = pi.SessionManager.create(temp, sessions);
const runtime = await pi.ModelRuntime.create({ modelsPath: null });
const provider = faux.fauxProvider({
  provider: "recall-faux",
  models: [{ id: "recall-faux" }],
});
runtime.registerNativeProvider(provider.provider);
let releaseBusy;
let busyEntered;
let fourthContext;
const busyRelease = new Promise((resolve) => {
  releaseBusy = resolve;
});
const busyEntry = new Promise((resolve) => {
  busyEntered = resolve;
});
provider.setResponses([
  faux.fauxAssistantMessage("seed complete"),
  faux.fauxAssistantMessage("idle complete"),
  async () => {
    busyEntered();
    return busyRelease.then(() => faux.fauxAssistantMessage("busy complete"));
  },
  (context) => {
    fourthContext = context;
    return faux.fauxAssistantMessage("steered complete");
  },
]);
const settings = pi.SettingsManager.inMemory({
  compaction: { enabled: false },
});
const loader = new pi.DefaultResourceLoader({
  cwd: temp,
  agentDir: temp,
  settingsManager: settings,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  extensionFactories: [registerPiRarebit],
});
await loader.reload();
const { session } = await pi.createAgentSession({
  cwd: temp,
  agentDir: temp,
  model: provider.getModel(),
  modelRuntime: runtime,
  noTools: "all",
  resourceLoader: loader,
  sessionManager: manager,
  settingsManager: settings,
});
const recallDirectories = [];
try {
  await session.prompt("seed persistent Session");
  await session.agent.waitForIdle();
  await session.prompt("/rarebit recall exact idle request", {
    streamingBehavior: "steer",
  });
  await waitFor(
    () => provider.state.callCount === 2,
    "idle Recall provider call",
  );
  await session.agent.waitForIdle();
  const userEntries = manager
    .getBranch()
    .filter((entry) => JSON.stringify(entry).includes("exact idle request"));
  assert.equal(userEntries.length, 1);
  const message = userEntries[0].message ?? userEntries[0];
  const idleMessageText = message.content[0].text;
  const idleConversationPath = conversationPathFrom(idleMessageText);
  const idleDetailedPath = detailedPathFrom(idleMessageText);
  assert.equal(
    idleMessageText,
    expectedRecallMarkdown(
      idleConversationPath,
      idleDetailedPath,
      "exact idle request",
    ),
  );
  recallDirectories.push(dirname(idleConversationPath));
  await access(idleConversationPath);
  await access(idleDetailedPath);
  assert.equal(
    manager
      .getBranch()
      .some(
        (entry) =>
          entry.customType === "rarebit.recall" ||
          entry.message?.customType === "rarebit.recall",
      ),
    false,
  );

  assert.equal(provider.state.callCount, 2);
  const queueUpdates = [];
  session.subscribe((event) => {
    if (event.type === "queue_update") queueUpdates.push(event);
  });
  const busyRun = session.prompt("busy seed");
  await busyEntry;
  await session.prompt("/rarebit recall exact busy request", {
    streamingBehavior: "steer",
  });
  await waitFor(
    () => queueUpdates.some((event) => event.steering?.length === 1),
    "busy Recall steering queue",
  );
  const queued = queueUpdates.find((event) => event.steering?.length === 1);
  assert.equal(queued.steering.length, 1);
  assert.equal(queued.followUp?.length ?? 0, 0);
  const queuedMessage = queued.steering[0];
  const busyMessageText =
    typeof queuedMessage === "string"
      ? queuedMessage
      : (queuedMessage.content?.[0]?.text ?? queuedMessage.content);
  const busyConversationPath = conversationPathFrom(busyMessageText);
  const busyDetailedPath = detailedPathFrom(busyMessageText);
  assert.equal(
    busyMessageText,
    expectedRecallMarkdown(
      busyConversationPath,
      busyDetailedPath,
      "exact busy request",
    ),
  );
  recallDirectories.push(dirname(busyConversationPath));
  await access(busyConversationPath);
  await access(busyDetailedPath);
  releaseBusy();
  await busyRun;
  await session.agent.waitForIdle();
  assert.equal(provider.state.callCount, 4);
  const recallCount = (texts) =>
    texts.filter((text) => text === busyMessageText).length;
  const fourthUserTexts = (fourthContext?.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.content?.[0]?.text ?? "");
  assert.equal(recallCount(fourthUserTexts), 1);
  const persistedUserTexts = manager
    .getBranch()
    .filter((entry) => (entry.message ?? entry).role === "user")
    .map((entry) => (entry.message ?? entry).content?.[0]?.text ?? "");
  assert.equal(recallCount(persistedUserTexts), 1);
  assert.equal(
    manager
      .getBranch()
      .some(
        (entry) =>
          entry.customType === "rarebit.recall" ||
          entry.message?.customType === "rarebit.recall",
      ),
    false,
  );
  console.log(
    `Pi ${packageJson.version} Recall E2E passed: idle and busy steer Markdown messages; no custom receipt.`,
  );
} finally {
  releaseBusy?.();
  await Promise.all(
    recallDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  session.dispose();
  runtime.unregisterProvider("recall-faux");
  await rm(temp, { recursive: true, force: true });
}
