// Empirical Pi 0.84.2 renderer probe. Uses the native fullscreen renderer and
// a synthetic terminal adapter; no provider, credentials, or private sessions.
import assert from "node:assert/strict";
import { TuiAltScreen, ScrollView, Container, Text } from "@earendil-works/pi-tui";
import { createRarebitRecapController } from "../src/rarebit-recap.mjs";
import { selectRarebits } from "../src/rarebit-core.mjs";

const { renderLayoutFrame } = await import(new URL("layout.js", import.meta.resolve("@earendil-works/pi-tui")));

let input;
const terminal = {
  columns: 80, rows: 12, kittyProtocolActive: false,
  start(fn) { input = fn; }, stop() {}, write() {}, moveBy() {},
  hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
  clearScreen() {}, setTitle() {}, setProgress() {},
};
const branch = [{ type: "message", id: "synthetic-owner", message: { role: "user", content: "Synthetic renderer probe" } }];
const selection = selectRarebits(branch);
const receipt = { status: "ok", sessionId: "synthetic-session", jobId: "synthetic-recap",
  observedAt: new Date(0).toISOString(), sessionStatus: "finished", summary: "SCROLLABLE_RECAP_SENTINEL",
  selection: { manifestHash: selection.manifestHash, selectorVersion: selection.manifest.selectorVersion } };
const ctx = { mode: "tui", ui: { setWidget() {} }, sessionManager: {
  getHeader: () => ({ id: receipt.sessionId }), getSessionFile: () => "/tmp/synthetic-probe.jsonl", getBranch: () => branch,
} };
const controller = createRarebitRecapController({
  appendEntry: (customType, data) => branch.push({ type: "custom", id: "synthetic-recap-entry", customType, data }),
  readCurrent: async () => ({ receipt, artifactState: { syncState: "assessment_current", applicability: "exact_selection",
    receiptRef: { jobId: receipt.jobId }, projection: { status: receipt.sessionStatus } } }),
});
assert.equal((await controller.showExisting(ctx)).shown, true);
const document = new Container();
document.addChild(controller.renderEntry(branch.at(-1), {}, { fg: (_color, text) => text }));
document.addChild(new Text(Array.from({ length: 30 }, (_, i) => `Synthetic update ${i}`).join("\n"), 0, 0));
const scroll = new ScrollView(document, { primary: true, follow: "none" });
const tui = new TuiAltScreen(terminal);
tui.setLayoutRoot(scroll);
const received = [];
tui.addInputListener((data) => { received.push(data); });
try {
  tui.start(); tui.renderNow();
  scroll.scrollToStart(); tui.renderNow();
  const atTop = renderLayoutFrame(scroll, 80, 12, () => {}).lines;
  assert.ok(atTop.some((line) => line.includes("SCROLLABLE_RECAP_SENTINEL")));
  input("\x1b[<65;3;4M"); tui.renderNow();
  const afterWheel = scroll.scrollTop;
  assert.ok(afterWheel > 0, "native wheel events scroll the transcript");
  input("\x1b[<0;3;2M"); input("\x1b[<0;3;2m"); input("g");
  scroll.scrollToEnd(); tui.renderNow();
  const atBottom = renderLayoutFrame(scroll, 80, 12, () => {}).lines;
  assert.ok(!atBottom.some((line) => line.includes("SCROLLABLE_RECAP_SENTINEL")), "recap is not pinned");
  console.log(JSON.stringify({ pi: "0.84.2", nativeRenderer: true, syntheticTerminal: true,
    recapVisibleAtTop: true, recapVisibleAtBottom: false, wheelScrollTop: afterWheel,
    keyboardReachedExtension: received.includes("g"),
    mouseReachedExtension: received.some((data) => data.startsWith("\x1b[<")),
  }, null, 2));
} finally { tui.stop(); controller.dispose(); }
