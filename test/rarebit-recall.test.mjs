import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerPiRarebit from "../src/extension.mjs";
import {
  RAREBIT_RECALL_CONVERSATION_FILENAME,
  RAREBIT_RECALL_DETAILED_FILENAME,
  materializeRarebitRecall,
} from "../src/rarebit-recall.mjs";

const entry = (id, message, timestamp = "2026-07-24T01:02:03.000Z") => ({
  type: "message",
  id,
  timestamp,
  message,
});

const branch = () => [
  entry("owner", { role: "user", content: "Exact owner evidence." }),
  entry(
    "tool",
    { role: "toolResult", content: "private tool output" },
    "2026-07-24T01:59:59.000Z",
  ),
  entry(
    "continue",
    {
      role: "assistant",
      stopReason: "toolUse",
      content: [{ type: "text", text: "Exact continuation evidence." }],
    },
    "2026-07-24T02:00:00.000Z",
  ),
  entry(
    "stop",
    {
      role: "assistant",
      stopReason: "stop",
      content: "Exact stop evidence.",
    },
    "2026-07-24T02:45:00.000Z",
  ),
];

function contextFor(activeBranch, sessionFile, notices = []) {
  return {
    hasUI: true,
    isIdle: () => true,
    ui: {
      notify: (text, level) => notices.push({ text, level }),
    },
    sessionManager: {
      getHeader: () => ({ id: "session-recall" }),
      getSessionFile: () => sessionFile,
      getBranch: () => activeBranch,
    },
  };
}

async function fixtureRoot(name) {
  const root = join(
    tmpdir(),
    `hc-rarebit-recall-test-${name}-${process.pid}-${Date.now()}`,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

test("recall materialization writes private detailed evidence and a chronological low-context conversation view", async () => {
  const root = await fixtureRoot("materialize");
  const sessionFile = join(root, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  const result = await materializeRarebitRecall(
    contextFor(branch(), sessionFile),
    {
      tempRoot: root,
      now: () => new Date("2026-07-24T03:04:05.000Z"),
    },
  );

  try {
    assert.equal(
      result.conversationPath,
      join(result.directory, RAREBIT_RECALL_CONVERSATION_FILENAME),
    );
    assert.equal(
      result.detailedPath,
      join(result.directory, RAREBIT_RECALL_DETAILED_FILENAME),
    );
    assert.notEqual(result.directory, root);
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(result.conversationPath)).mode & 0o777, 0o600);
    assert.equal((await stat(result.detailedPath)).mode & 0o777, 0o600);

    const detailed = JSON.parse(await readFile(result.detailedPath, "utf8"));
    assert.equal(detailed.createdAt, "2026-07-24T03:04:05.000Z");
    assert.deepEqual(detailed.evidenceAuthority, {
      type: "pi_session_jsonl",
      path: sessionFile,
    });
    assert.equal(detailed.session.id, "session-recall");
    assert.equal(detailed.session.activeBranch.leafEntryId, "stop");
    assert.deepEqual(detailed.session.activeBranch.entryIds, [
      "owner",
      "tool",
      "continue",
      "stop",
    ]);
    assert.equal(detailed.selection.occurrenceCount, 3);
    assert.deepEqual(
      detailed.selection.occurrences.map(({ sourceEntryId, text }) => ({
        sourceEntryId,
        text,
      })),
      [
        { sourceEntryId: "owner", text: "Exact owner evidence." },
        {
          sourceEntryId: "continue",
          text: "Exact continuation evidence.",
        },
        { sourceEntryId: "stop", text: "Exact stop evidence." },
      ],
    );
    assert.doesNotMatch(
      await readFile(result.detailedPath, "utf8"),
      /private tool output/,
    );

    const conversation = JSON.parse(
      await readFile(result.conversationPath, "utf8"),
    );
    assert.deepEqual(conversation, {
      schemaVersion: 1,
      type: "rarebit_conversation",
      timeZone: "UTC",
      hours: [
        {
          hour: "2026-07-24T01:00Z",
          messages: [{ role: "user", content: "Exact owner evidence." }],
        },
        {
          hour: "2026-07-24T02:00Z",
          messages: [
            { role: "agent", content: "Exact continuation evidence." },
            { role: "agent", content: "Exact stop evidence." },
          ],
        },
      ],
    });
    const conversationText = await readFile(result.conversationPath, "utf8");
    assert.doesNotMatch(
      conversationText,
      /sourceEntryId|occurrenceId|manifestHash|contentHash|timestamp|session/i,
    );
  } finally {
    await result.discard();
    await rm(root, { recursive: true, force: true });
  }
});

test("conversation buckets sort chronologically and treat producer-tagged input as a normal user message", async () => {
  const root = await fixtureRoot("bucket-order");
  const sessionFile = join(root, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  const activeBranch = [
    {
      ...entry(
        "rpc-user",
        { role: "user", content: "Unknown-origin user evidence." },
        "2026-07-24T02:10:00.000Z",
      ),
      producer: "rpc",
    },
    entry(
      "earlier-agent",
      {
        role: "assistant",
        stopReason: "stop",
        content: "Earlier agent evidence.",
      },
      "2026-07-24T01:10:00.000Z",
    ),
    entry(
      "unknown-time",
      {
        role: "assistant",
        stopReason: "stop",
        content: "Unknown-time agent evidence.",
      },
      null,
    ),
    entry(
      "later-agent",
      {
        role: "assistant",
        stopReason: "stop",
        content: "Later agent evidence.",
      },
      "2026-07-24T02:20:00.000Z",
    ),
  ];
  const result = await materializeRarebitRecall(
    contextFor(activeBranch, sessionFile),
    { tempRoot: root },
  );

  try {
    const conversation = JSON.parse(
      await readFile(result.conversationPath, "utf8"),
    );
    assert.deepEqual(conversation.hours, [
      {
        hour: "2026-07-24T01:00Z",
        messages: [{ role: "agent", content: "Earlier agent evidence." }],
      },
      {
        hour: "2026-07-24T02:00Z",
        messages: [
          { role: "user", content: "Unknown-origin user evidence." },
          { role: "agent", content: "Later agent evidence." },
        ],
      },
      {
        hour: null,
        messages: [{ role: "agent", content: "Unknown-time agent evidence." }],
      },
    ]);
    assert.doesNotMatch(
      await readFile(result.conversationPath, "utf8"),
      /human|producer|rpc/,
    );
    const detailed = JSON.parse(await readFile(result.detailedPath, "utf8"));
    assert.equal(
      detailed.selection.occurrences.every(
        (occurrence) => !Object.hasOwn(occurrence, "producer"),
      ),
      true,
    );
  } finally {
    await result.discard();
    await rm(root, { recursive: true, force: true });
  }
});

test("a second-file write failure removes the partial invocation directory", async () => {
  const root = await fixtureRoot("partial-write");
  const sessionFile = join(root, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  let writes = 0;

  await assert.rejects(
    materializeRarebitRecall(contextFor(branch(), sessionFile), {
      tempRoot: root,
      writeJson: async (path, document) => {
        writes += 1;
        if (writes === 2) throw new Error("injected detailed write failure");
        await writeFile(path, `${JSON.stringify(document)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
      },
    }),
    /injected detailed write failure/,
  );
  assert.equal(writes, 2);
  assert.deepEqual(await readdir(root), ["session.jsonl"]);
  await rm(root, { recursive: true, force: true });
});

function extensionHarness({ recallMaterializer, sendUserMessage } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const sent = [];
  const tools = [];
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: (...args) => tools.push(args),
    sendMessage: () => {
      throw new Error("Recall must not call sendMessage");
    },
    appendEntry: () => {
      throw new Error("Recall must not append an entry");
    },
    sendUserMessage: (...args) => {
      sent.push({ kind: "user", args });
      return sendUserMessage?.(...args);
    },
  };
  registerPiRarebit(pi, {
    ...(recallMaterializer ? { recallMaterializer } : {}),
  });
  return { commands, handlers, pi, sent, tools };
}

test("recall sends one exact fenced Markdown steer message in idle and busy contexts", async () => {
  const sessionFile = "/tmp/session-recall.jsonl";
  const recall = {
    conversationPath:
      "/tmp/Rare bit [会话] (one) **/tick`` and ~~\nnext/rarebit-conversation.json",
    detailedPath:
      "/tmp/Detailed [证据] (two) **/tick```` and ~~~\n~~~line-start/rarebit-evidence.json",
    sessionId: "session-recall",
    sessionFile,
    branchLeafId: "stop",
  };
  const prompt =
    "\n# Heading-looking request\n- list-looking item\n```text\ninside backticks\n```\n~~~~\ninside tildes\n~~~~\nTrailing request\n";
  const expectedMessage = `# Rarebit Recall

*Use these local private evidence files to recover historical context for this turn.*

## How to use this bundle

1. Treat **Current request** below as the exact current user request.
2. Read **Conversation** first for meaning.
3. Use **Detailed evidence** only for source, Session, branch, or lineage facts.
4. Answer the current request using this evidence.

## Local private evidence files

**Conversation** — \`rarebit_conversation/v1\`

\`\`\`text
${recall.conversationPath}
\`\`\`

**Detailed evidence** — \`rarebit_message_recall/v1\`

~~~~text
${recall.detailedPath}
~~~~

## Current request

\`\`\`\`text
${prompt}
\`\`\`\``;

  for (const busy of [false, true]) {
    const notices = [];
    const harness = extensionHarness({ recallMaterializer: async () => recall });
    const ctx = contextFor(branch(), sessionFile, notices);
    ctx.isIdle = () => !busy;
    await harness.commands.get("rarebit").handler(`recall ${prompt}`, ctx);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].args[0], expectedMessage);
    assert.deepEqual(harness.sent[0].args[1], { deliverAs: "steer" });
    assert.equal(expectedMessage.includes(recall.conversationPath), true);
    assert.equal(expectedMessage.includes(recall.detailedPath), true);
    assert.equal(expectedMessage.includes(prompt), true);
    assert.match(notices.at(-1).text, /bundle prepared; turn requested/i);
  }
});

test("long delimiter runs ending at value boundaries use the shortest safe fences", async () => {
  const pathBackticks = "`".repeat(80);
  const pathTildes = "~".repeat(47);
  const conversationPath = `/tmp/long-runs/${pathBackticks}/${pathTildes}`;
  const requestTildes = "~".repeat(96);
  const requestBackticks = "`".repeat(63);
  const request = `Boundary ${requestTildes} ${requestBackticks}`;
  const harness = extensionHarness({
    recallMaterializer: async () => ({
      conversationPath,
      detailedPath: "/tmp/rarebit-evidence.json",
      sessionId: "session-recall",
      sessionFile: "/tmp/session-recall.jsonl",
      branchLeafId: "stop",
    }),
  });

  await harness.commands
    .get("rarebit")
    .handler(
      `recall ${request}`,
      contextFor(branch(), "/tmp/session-recall.jsonl"),
    );

  assert.equal(harness.sent.length, 1);
  const message = harness.sent[0].args[0];
  const conversationBlock = message.match(
    /\*\*Conversation\*\* — `rarebit_conversation\/v1`\n\n([`~]+)text\n([^\n]*)\n\1\n\n\*\*Detailed evidence\*\*/,
  );
  assert.ok(conversationBlock);
  assert.equal(conversationBlock[2], conversationPath);
  assert.equal(conversationBlock[2].endsWith(pathTildes), true);
  const conversationFence = conversationBlock[1];
  assert.equal(conversationFence[0], "~");
  assert.ok(conversationFence.length >= 3);
  assert.equal(conversationFence.length, pathTildes.length + 1);
  assert.ok(conversationFence.length > pathTildes.length);
  assert.ok(conversationFence.length < pathBackticks.length + 1);

  const requestBlock = message.match(
    /## Current request\n\n([`~]+)text\n([\s\S]*)\n\1$/,
  );
  assert.ok(requestBlock);
  assert.equal(requestBlock[2], request);
  assert.equal(requestBlock[2].endsWith(requestBackticks), true);
  const requestFence = requestBlock[1];
  assert.equal(requestFence[0], "`");
  assert.ok(requestFence.length >= 3);
  assert.equal(requestFence.length, requestBackticks.length + 1);
  assert.ok(requestFence.length > requestBackticks.length);
  assert.ok(requestFence.length < requestTildes.length + 1);
  assert.equal(message.endsWith(`${request}\n${requestFence}`), true);
});

test("single-send failure discards the prepared Recall bundle", async () => {
  const notices = [];
  let discarded = 0;
  const harness = extensionHarness({
    recallMaterializer: async () => ({
      conversationPath: "/tmp/rarebit-conversation.json",
      detailedPath: "/tmp/rarebit-evidence.json",
      sessionId: "session-recall",
      sessionFile: "/tmp/session-recall.jsonl",
      branchLeafId: "stop",
      selectedMessageCount: 3,
      discard: async () => {
        discarded += 1;
      },
    }),
    sendUserMessage: () => {
      throw new Error("synchronous prompt invocation failure");
    },
  });

  await harness.commands
    .get("rarebit")
    .handler(
      "recall Continue from the evidence",
      contextFor(branch(), "/tmp/session-recall.jsonl", notices),
    );

  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].kind, "user");
  assert.equal(discarded, 1);
  assert.match(notices.at(-1).text, /recall failed/i);
});

test("missing prompt performs no extraction or send and shows concise usage", async () => {
  let materializations = 0;
  const notices = [];
  const harness = extensionHarness({
    recallMaterializer: async () => {
      materializations += 1;
    },
  });

  await harness.commands
    .get("rarebit")
    .handler(
      "recall",
      contextFor(branch(), "/tmp/session-recall.jsonl", notices),
    );

  assert.equal(materializations, 0);
  assert.deepEqual(harness.sent, []);
  assert.equal(
    notices.at(-1).text,
    "Usage: /rarebit recall <prompt...>",
  );
});

test("materialization failure is actionable and sends neither context nor prompt", async () => {
  const notices = [];
  const harness = extensionHarness({
    recallMaterializer: async () => {
      throw new Error("temp directory is read-only");
    },
  });

  await harness.commands
    .get("rarebit")
    .handler(
      "recall Continue from the evidence",
      contextFor(branch(), "/tmp/session-recall.jsonl", notices),
    );

  assert.deepEqual(harness.sent, []);
  assert.match(notices.at(-1).text, /temp directory is read-only/);
  assert.match(notices.at(-1).text, /Verify the current Session/i);
  assert.equal(notices.at(-1).level, "error");
});

test("exact-leaf changes cancel before sending and discard the prepared bundle", async () => {
  const notices = [];
  let discarded = 0;
  const harness = extensionHarness({
    recallMaterializer: async () => ({
      conversationPath: "/tmp/rarebit-conversation.json",
      detailedPath: "/tmp/rarebit-evidence.json",
      sessionId: "session-recall",
      sessionFile: "/tmp/session-recall.jsonl",
      branchLeafId: "different-leaf",
      discard: async () => { discarded += 1; },
    }),
  });
  await harness.commands.get("rarebit").handler(
    "recall Second",
    contextFor(branch(), "/tmp/session-recall.jsonl", notices),
  );
  assert.deepEqual(harness.sent, []);
  assert.equal(discarded, 1);
  assert.match(notices.at(-1).text, /Session or branch changed/);
});
