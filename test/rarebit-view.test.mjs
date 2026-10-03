import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRarebitViewController } from "../src/rarebit-view.mjs";
import registerRarebit from "../src/extension.mjs";
import { rarebitPaletteCommand } from "../src/rarebit-settings-ui.mjs";

// A host boundary records command/UI effects. The reader uses the installed Pi
// Markdown and keyboard implementations; no view helper is replaced.
function host({ mode = "tui", failOverlay = false } = {}) {
  const commands = new Map(), shortcuts = new Map(), events = new Map(), entryRenderers = new Map();
  const notices = [], statuses = new Map(), overlays = [];
  let settingsReads = 0, picker, renderRequests = 0;
  const tui = { children: [], terminal: { rows: 25, columns: 100 }, requestRender() { renderRequests++; }, showOverlay() {} };
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text, inverse: (text) => text };
  const entries = [
    { type: "message", id: "old", timestamp: "2026-01-01T10:00:00Z", message: { role: "user", content: "Older Needle" } },
    { type: "compaction", id: "cut1", firstKeptEntryId: "now", timestamp: "2026-01-01T11:00:00Z" },
    { type: "compaction", id: "cut2", firstKeptEntryId: "now", timestamp: "2026-01-01T12:00:00Z" },
    { type: "message", id: "now", timestamp: "2026-01-01T12:00:01Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Newer needle" }, { type: "thinking", thinking: "Hidden reasoning" }] } },
    { type: "message", id: "tool", message: { role: "toolResult", content: [{ type: "text", text: "Hidden tool" }] } },
  ];
  const ctx = {
    mode, hasUI: true,
    sessionManager: { getBranch: () => entries, getHeader: () => ({ id: "mock" }) },
    ui: {
      notify: (text) => notices.push(text),
      setStatus(key, value) { if (value === undefined) statuses.delete(key); else statuses.set(key, value); },
      setWidget() {},
      async select() { assert.equal(statuses.size, 0); return picker; },
      custom(factory, options) {
        if (failOverlay && options?.overlay) return Promise.reject(new Error("mock unavailable"));
        return new Promise((resolve, reject) => {
          let finished = false;
          const done = () => { finished = true; resolve(); };
          try {
            const component = factory(tui, theme, {}, done);
            if (!finished && options?.overlay) {
              overlays.push({ component, options, done });
              options.onHandle?.({ isFocused: () => !options.overlayOptions.nonCapturing });
            }
          } catch (error) { reject(error); }
        });
      },
    },
  };
  const pi = {
    on(name, handler) { const handlers = events.get(name) ?? []; handlers.push(handler); events.set(name, handlers); },
    registerEntryRenderer: (name, renderer) => entryRenderers.set(name, renderer),
    registerCommand: (name, definition) => commands.set(name, definition),
    registerShortcut: (name, definition) => shortcuts.set(name, definition),
  };
  registerRarebit(pi, { settingsLoader: async () => { settingsReads++; return {}; }, activityReporter: { start() {}, update() {}, stop() {} } });
  return { ctx, commands, shortcuts, notices, statuses, overlays, tui, entries, entryRenderers,
    command: (args) => commands.get("rarebit").handler(args, ctx),
    event: async (name, detail = {}) => { for (const handler of events.get(name) ?? []) await handler(detail, ctx); },
    setPicker(value) { picker = value; }, get settingsReads() { return settingsReads; }, get renderRequests() { return renderRequests; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("view command projects all branch prose and each compaction without reading settings", async () => {
  const h = host();
  await h.command("view all");
  const pane = h.overlays.at(-1).component;
  const output = pane.render(100).join("\n");
  assert.match(output, /Older Needle/);
  assert.match(output, /Newer needle/);
  assert.doesNotMatch(output, /Hidden reasoning|Hidden tool/);
  assert.match(output, /□ user message/);
  assert.match(output, /● agent stops/);
  assert.equal(output.match(/compaction /g).length, 2);
  assert.equal(h.settingsReads, 0);
  await h.command("view off");
  assert.equal(h.statuses.size, 0);
});

test("focused overlay accepts Kitty search, smartcase, repeat and two-stage Escape", async () => {
  const h = host();
  await h.command("view all");
  const pane = h.overlays.at(-1).component;
  pane.render(100);
  pane.handleInput("\x1b[47u");
  pane.handleInput("needle");
  pane.handleInput("\r");
  assert.match(pane.render(100).at(-1), /\/needle · 1\/2/);
  pane.handleInput("\x1b[110u");
  assert.match(pane.render(100).at(-1), /\/needle · 2\/2/);
  pane.handleInput("N");
  assert.match(pane.render(100).at(-1), /\/needle · 1\/2/);
  pane.handleInput("?"); pane.handleInput("Needle"); pane.handleInput("\r");
  assert.match(pane.render(100).at(-1), /\?Needle · 1\/1/);
  pane.handleInput("\x1b");
  assert.equal(h.statuses.size, 1);
  assert.doesNotMatch(pane.render(100).at(-1), /Needle ·/);
  pane.handleInput("\x1b");
  assert.equal(h.statuses.size, 0);
});

test("toggle defaults to all; overlay cycle and toggle use the controller and preserve preference", async () => {
  const h = host();
  await h.shortcuts.get("ctrl+alt+r").handler(h.ctx);
  assert.match(h.statuses.get("rarebit-view"), /view: all/);
  h.overlays.at(-1).component.handleInput("\x1b[110;13u");
  await tick();
  assert.match(h.statuses.get("rarebit-view"), /view: peek/);
  assert.equal(h.overlays.at(-1).options.overlayOptions.nonCapturing, true);
  await h.shortcuts.get("ctrl+super+r").handler(h.ctx);
  assert.equal(h.statuses.size, 0);
  await h.shortcuts.get("ctrl+alt+r").handler(h.ctx);
  assert.match(h.statuses.get("rarebit-view"), /view: peek/);
  await h.command("view off");
});

test("context fails closed and falls back to all on an unsupported transcript", async () => {
  const h = host();
  await h.command("view context");
  await tick();
  assert.match(h.notices.join("\n"), /Context view is unavailable on this Pi version; showing all\./);
  assert.match(h.statuses.get("rarebit-view"), /view: all/);
  await h.command("view off");
});

test("picker closes the current view; shutdown clears it and invalidates pending activation", async () => {
  const h = host();
  assert.equal(rarebitPaletteCommand({ id: "view" }), "view");
  await h.command("view all");
  h.setPicker(undefined);
  await h.command("view");
  assert.equal(h.statuses.size, 0);
  const pending = h.command("view all");
  await h.event("session_shutdown");
  await pending;
  assert.equal(h.statuses.size, 0);
  await h.command("view peek");
  const pane = h.overlays.at(-1).component;
  assert.equal(pane.render(100).length, 18);
  h.tui.terminal.rows = 40;
  assert.equal(pane.render(100).length, 33);
  await h.event("session_shutdown");
  assert.equal(h.statuses.size, 0);
});

test("search wrap notice survives renders and clears on the next key", async () => {
  const h = host();
  await h.command("view all");
  const pane = h.overlays.at(-1).component;
  assert.match(pane.render(120).at(-1), /ctrl\+alt\+n next/);
  pane.handleInput("/"); pane.handleInput("needle"); pane.handleInput("\r");
  pane.handleInput("n"); pane.handleInput("n");
  assert.match(pane.render(120).at(-1), /search hit BOTTOM, continuing at TOP/);
  assert.match(pane.render(120).at(-1), /search hit BOTTOM, continuing at TOP/);
  pane.handleInput("N");
  assert.match(pane.render(120).at(-1), /search hit TOP, continuing at BOTTOM/);
  pane.handleInput("j");
  assert.doesNotMatch(pane.render(120).at(-1), /search hit/);
  assert.match(pane.render(120).at(-1), /\/needle · 2\/2/);
  await h.command("view off");
});

// Override only for a second installed Pi version. No personal Session is read.
const piRoot = process.env.RAREBIT_TEST_PI_ROOT ?? dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const piRequire = createRequire(pathToFileURL(join(piRoot, "package.json")));
const realTui = await import(pathToFileURL(piRequire.resolve("@earendil-works/pi-tui")));
const { AssistantMessageComponent } = await import(pathToFileURL(join(piRoot, "dist/modes/interactive/components/assistant-message.js")));
const { initTheme } = await import(pathToFileURL(join(piRoot, "dist/modes/interactive/theme/theme.js")));
initTheme("dark", false);
let ThemedText;
try {
  ({ ThemedText } = await import(pathToFileURL(join(piRoot, "dist/modes/interactive/components/themed-text.js"))));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
const notice = (text) => ThemedText ? new ThemedText(() => text, 1, 0) : new realTui.Text(text, 1, 0);

function nativeHost(components) {
  const document = new realTui.Container(), chat = new realTui.Container();
  for (const component of components) chat.addChild(component);
  document.addChild(chat);
  const tui = { children: [document], terminal: { rows: 30, columns: 100 }, requestRender() {} };
  const ctx = { mode: "tui", hasUI: true, sessionManager: { getBranch: () => [] }, ui: {
    setStatus() {}, notify(text) { assert.fail(text); },
    async custom(factory) { return factory(tui, {}, {}, () => {}); },
  } };
  return { chat, ctx, text: () => realTui.stripTerminalSequences(chat.render(100).join("\n")) };
}

test("context shows only newly appended real Pi notice components and restores earlier notices on off", async () => {
  const h = nativeHost([notice("EARLIER_NOTICE")]);
  const controller = createRarebitViewController();
  await controller.command(h.ctx, "context");
  try {
    h.chat.addChild(new realTui.Spacer(5));
    h.chat.addChild(notice("NEW_NOTICE"));
    assert.equal(h.text().trim(), "NEW_NOTICE");
  } finally { controller.dispose(); }
  assert.match(h.text(), /EARLIER_NOTICE/);
  assert.match(h.text(), /NEW_NOTICE/);
});

test("context shows a new status when Pi reuses an earlier notice component", async () => {
  let message = "EARLIER_NOTICE";
  const previousNotice = ThemedText ? new ThemedText(() => message, 1, 0) : new realTui.Text(message, 1, 0);
  const h = nativeHost([previousNotice]);
  const controller = createRarebitViewController();
  await controller.command(h.ctx, "context");
  try {
    assert.doesNotMatch(h.text(), /EARLIER_NOTICE/);
    previousNotice.invalidate();
    assert.doesNotMatch(realTui.stripTerminalSequences(h.chat.render(40).join("\n")), /EARLIER_NOTICE/);
    message = "UPDATED_NOTICE";
    if (ThemedText) previousNotice.invalidate();
    else previousNotice.setText(message);
    assert.match(h.text(), /UPDATED_NOTICE/);
    assert.doesNotMatch(h.text(), /EARLIER_NOTICE/);
  } finally { controller.dispose(); }
  assert.match(h.text(), /UPDATED_NOTICE/);
});

test("Session shutdown detaches Recap renderers from the outgoing context", async () => {
  const h = host();
  await h.event("session_start");
  const component = h.entryRenderers.get("rarebit-recap")({
    type: "custom", id: "recap", customType: "rarebit-recap",
    data: { version: 1, heading: "Mock Recap", summary: "Generic recap prose" },
  }, {}, { fg: (_color, text) => text });
  for (let i = 0; i < 20 && component.render(100).join("\n").includes("Recap loading"); i++) await tick();
  assert.match(component.render(100).join("\n"), /Generic recap prose/);
  await h.event("session_shutdown");
  h.ctx.sessionManager.getBranch = () => { throw new Error("outgoing Pi context is stale"); };
  assert.doesNotThrow(() => component.render(100));
  assert.match(component.render(100).join("\n"), /Generic recap prose/);
});

test("context preserves literal thinking-label prose with real Pi assistant components", async () => {
  for (const withThinking of [false, true]) for (const hiddenBefore of [false, true]) {
    const message = { role: "assistant", stopReason: "stop", content: [
      ...(withThinking ? [{ type: "thinking", thinking: "REASONING_MUST_STAY_HIDDEN" }] : []),
      { type: "text", text: "Thinking..." },
    ] };
    const assistant = new AssistantMessageComponent(message, hiddenBefore);
    const h = nativeHost([assistant]);
    const original = h.text();
    const controller = createRarebitViewController();
    await controller.command(h.ctx, "context");
    try {
      assert.equal(controller.activeMode, "context");
      const during = h.text();
      assert.equal(during.match(/Thinking\.\.\./g)?.length, 1, "selected literal prose must survive once");
      assert.doesNotMatch(during, /REASONING_MUST_STAY_HIDDEN/);
      // A Pi invalidation rebuilds the content tree. It must not revive chrome
      // or change the selected prose on the next native render.
      assistant.invalidate();
      assert.equal(h.text().match(/Thinking\.\.\./g)?.length, 1);
    } finally { controller.dispose(); }
    assert.equal(h.text(), original, "off restores the real component rendering");
    assert.equal(assistant.hideThinkingBlock, hiddenBefore);
  }
});

test("non-TUI and rejected overlay operations stay off without unhandled rejections", async () => {
  for (const options of [{ mode: "rpc" }, { failOverlay: true }]) {
    const h = host(options);
    await h.command("view all");
    assert.equal(h.statuses.size, 0);
    assert.match(h.notices.join("\n"), /unavailable on this Pi version/);
    assert.equal(h.settingsReads, 0);
  }
});
