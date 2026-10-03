import { messageTextBlocks, rarebitMetadata } from "./rarebit-core.mjs";
import { rarebitOccurrencePresentation } from "./rarebit-visual-language.mjs";
import { RECAP_ENTRY_TYPE } from "./rarebit-read-checkpoint.mjs";
import { observedAtLabel } from "./rarebit-recap.mjs";

const MODES = ["context", "all", "peek"];
const TOGGLE_KEYS = ["ctrl+alt+r", "ctrl+super+r"];
const CYCLE_KEYS = ["ctrl+alt+n", "ctrl+super+n"];
const DOCK_ROWS = 7;
let peers;
async function loadPeers() {
  peers ??= Promise.all([import("@earendil-works/pi-tui"), import("@earendil-works/pi-coding-agent")])
    .then(([tui, agent]) => ({ ...tui, getMarkdownTheme: agent.getMarkdownTheme }));
  return peers;
}

function branchItems(ctx) {
  const branch = ctx.sessionManager.getBranch();
  const cutoffs = new Map();
  for (const entry of branch) {
    if (entry.type !== "compaction") continue;
    const cutoff = entry.firstKeptEntryId ?? entry.id;
    const markers = cutoffs.get(cutoff) ?? [];
    markers.push(entry);
    cutoffs.set(cutoff, markers);
  }
  const items = [];
  branch.forEach((entry, order) => {
    for (const marker of cutoffs.get(entry.id) ?? [])
      items.push({ kind: "compaction", time: observedAtLabel(marker.timestamp, "host") });
    const meta = rarebitMetadata(entry, order);
    if (meta) items.push({ ...meta, kind: "rarebit", text: messageTextBlocks(entry.message).join("\n\n"), time: observedAtLabel(meta.timestamp, "host") });
  });
  return items;
}

/** One disposable reader. Selection stays in the semantic backend. */
class RarebitPane {
  constructor(tui, theme, ctx, mode, primitives, transitions) {
    Object.assign(this, { tui, theme, ctx, mode, primitives, transitions });
    this.scrollTop = 0;
    this.follow = true;
    this.bodyHeight = 1;
    this.body = [];
    this.cache = new Map();
  }
  lines(items, width) {
    const { theme: t, primitives: p } = this;
    const lines = [];
    const texts = new Set();
    for (const item of items) {
      if (lines.length) lines.push("");
      if (item.kind === "compaction") {
        lines.push(t.fg("muted", `── compaction ${item.time} · context restarts here ──`));
        continue;
      }
      const presentation = rarebitOccurrencePresentation(item);
      const color = item.role === "user" ? "success" : item.outcome === "continuation" ? "accent" : "muted";
      lines.push(` ${t.fg(color, `${presentation.mark} ${presentation.label}`)} ${t.fg("dim", item.time)}`);
      texts.add(item.text);
      let md = this.cache.get(item.text);
      if (!md) this.cache.set(item.text, md = new p.Markdown(item.text, 3, 0, p.getMarkdownTheme()));
      lines.push(...md.render(width));
    }
    for (const text of this.cache.keys()) if (!texts.has(text)) this.cache.delete(text);
    return lines;
  }
  matches() {
    if (!this.search?.query) return [];
    const { stripTerminalSequences, visibleWidth } = this.primitives;
    const sensitive = /[A-Z]/.test(this.search.query);
    const needle = sensitive ? this.search.query : this.search.query.toLowerCase();
    const matches = [];
    this.body.forEach((line, index) => {
      const plain = stripTerminalSequences(line);
      const hay = sensitive ? plain : plain.toLowerCase();
      for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + Math.max(1, needle.length)))
        matches.push({ line: index, col: visibleWidth(plain.slice(0, at)), width: visibleWidth(plain.slice(at, at + needle.length)) });
    });
    return matches;
  }
  highlight(line, matches, current) {
    const { sliceByColumn, stripTerminalSequences, visibleWidth } = this.primitives;
    let out = "", cursor = 0;
    for (const m of matches) {
      const text = stripTerminalSequences(sliceByColumn(line, m.col, m.width));
      out += sliceByColumn(line, cursor, m.col - cursor) +
        (m === current ? this.theme.inverse(text) : this.theme.bg("searchMatchBg", text));
      cursor = m.col + m.width;
    }
    return out + sliceByColumn(line, cursor, Math.max(0, visibleWidth(line) - cursor));
  }
  render(width) {
    const { theme: t, primitives: p } = this;
    const items = branchItems(this.ctx);
    const rows = Math.max(3, this.tui.terminal.rows);
    const height = this.mode === "peek" ? Math.max(3, rows - Math.min(DOCK_ROWS, rows - 3)) : rows;
    this.body = this.lines(items, width);
    this.bodyHeight = height - 2;
    const maxTop = Math.max(0, this.body.length - this.bodyHeight);
    if (this.follow) this.scrollTop = maxTop;
    this.scrollTop = Math.min(Math.max(0, this.scrollTop), maxTop);
    const title = ` Rarebits · ${items.filter((item) => item.kind === "rarebit").length} on this branch `;
    const top = t.fg("accent", t.bold(title)) + t.fg("dim", "─".repeat(Math.max(0, width - p.visibleWidth(title))));
    const matches = this.matches();
    const current = matches[this.search?.index];
    const view = [];
    for (let i = this.scrollTop; i < Math.min(this.body.length, this.scrollTop + this.bodyHeight); i++) {
      const onLine = matches.filter((m) => m.line === i);
      view.push(onLine.length ? this.highlight(this.body[i], onLine, current) : this.body[i]);
    }
    while (view.length < this.bodyHeight) view.push("");
    let left;
    if (this.prompt) left = t.fg("accent", ` ${this.prompt.forward ? "/" : "?"}${this.prompt.text}`) + "█";
    else if (this.message) left = t.fg("warning", ` ${this.message}`);
    else if (this.search && matches.length) left = t.fg("muted", ` ${this.search.forward ? "/" : "?"}${this.search.query} · ${this.search.index + 1}/${matches.length} · n/N`);
    else left = t.fg("dim", this.mode === "all"
      ? ` j/k · u/d · b/space · g/G · / ? n N search · esc/q close · ${CYCLE_KEYS[0]} next `
      : ` keys go to the editor · wheel scrolls · ${TOGGLE_KEYS[0]} closes · replies appear when finished `);
    const pos = this.body.length > this.bodyHeight ? `${this.scrollTop + 1}-${Math.min(this.body.length, this.scrollTop + this.bodyHeight)}/${this.body.length}` : "";
    const bottom = left + " ".repeat(Math.max(0, width - p.visibleWidth(left) - pos.length)) + t.fg("muted", pos);
    return [top, ...view, bottom].map((line) => {
      const cut = p.truncateToWidth(line, width, "");
      return t.bg("customMessageBg", cut + " ".repeat(Math.max(0, width - p.visibleWidth(cut))));
    });
  }
  scrollBy(delta) {
    const maxTop = Math.max(0, this.body.length - this.bodyHeight);
    this.scrollTop = Math.min(Math.max(0, this.scrollTop + delta), maxTop);
    this.follow = this.scrollTop >= maxTop;
    this.tui.requestRender();
  }
  jump(forward, fromCurrent) {
    const matches = this.matches();
    if (!matches.length) {
      this.message = `Pattern not found: ${this.search.query}`;
      return this.tui.requestRender();
    }
    const current = matches[this.search.index];
    const anchor = fromCurrent && current ? current : { line: forward ? this.scrollTop - 1 : this.scrollTop + this.bodyHeight, col: 0 };
    let index = forward
      ? matches.findIndex((m) => m.line > anchor.line || (m.line === anchor.line && m.col > anchor.col))
      : matches.findLastIndex((m) => m.line < anchor.line || (m.line === anchor.line && m.col < anchor.col));
    if (index < 0) {
      index = forward ? 0 : matches.length - 1;
      this.message = forward ? "search hit BOTTOM, continuing at TOP" : "search hit TOP, continuing at BOTTOM";
    }
    this.search.index = index;
    const line = matches[index].line;
    if (line < this.scrollTop || line >= this.scrollTop + this.bodyHeight)
      this.scrollTop = Math.max(0, line - Math.floor(this.bodyHeight / 3));
    this.follow = false;
    this.tui.requestRender();
  }
  handleInput(data) {
    const p = this.primitives;
    const key = (expected) => p.matchesKey(data, expected);
    if (TOGGLE_KEYS.some(key)) return this.transitions.toggle();
    if (CYCLE_KEYS.some(key)) return this.transitions.cycle();
    const text = p.decodeKittyPrintable(data) ?? (data.startsWith("\x1b") ? undefined : data);
    this.message = undefined;
    if (this.prompt) {
      if (key("escape")) this.prompt = undefined;
      else if (key("enter")) {
        const { text: queryText, forward } = this.prompt;
        this.prompt = undefined;
        const query = queryText || this.search?.query;
        if (query) { this.search = { query, forward, index: -1 }; return this.jump(forward, false); }
      } else if (key("backspace")) {
        if (!this.prompt.text) this.prompt = undefined;
        else this.prompt.text = [...this.prompt.text].slice(0, -1).join("");
      } else if (text && !/[\x00-\x1f\x7f]/.test(text)) this.prompt.text += text;
      return this.tui.requestRender();
    }
    if (text === "/" || text === "?") { this.prompt = { text: "", forward: text === "/" }; return this.tui.requestRender(); }
    if (text === "n" || text === "N") {
      if (this.search) this.jump(text === "n" ? this.search.forward : !this.search.forward, true);
      return;
    }
    if (key("escape") && this.search) { this.search = undefined; return this.tui.requestRender(); }
    if (key("escape") || text === "q") return this.transitions.close();
    if (key("up") || text === "k") return this.scrollBy(-1);
    if (key("down") || text === "j") return this.scrollBy(1);
    const page = Math.max(1, this.bodyHeight - 2), half = Math.max(1, Math.floor(this.bodyHeight / 2));
    if (key("pageUp") || text === "b") return this.scrollBy(-page);
    if (key("pageDown") || text === " ") return this.scrollBy(page);
    if (key("ctrl+u") || text === "u") return this.scrollBy(-half);
    if (key("ctrl+d") || text === "d") return this.scrollBy(half);
    if (key("home") || text === "g") return this.scrollBy(-Infinity);
    if (key("end") || text === "G") return this.scrollBy(Infinity);
  }
  handleMouse(event) {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollBy(event.wheelDelta);
    return { handled: true };
  }
  invalidate() { this.cache.clear(); }
}

const typeName = (component) => component?.constructor?.name;
/**
 * Unsupported by Pi and can break on any release. This adapter relies on:
 * tui.children[0] being the document container and its last child being chat;
 * mutable Container.render/children and mouseLayout; built-in constructor names;
 * AssistantMessageComponent.lastMessage, hideThinkingBlock, hiddenThinkingLabel,
 * setHideThinkingBlock, contentContainer.children; hidden thinking chrome as Text
 * or MouseRegion.child Text; ThemedText (or older Text) notice classes and text;
 * CustomEntryComponent.entry.customType. It changes display
 * only. Pi still owns context, compaction, transcript layout, and Session data.
 */
function tryAttach(tui, p, unavailable) {
  const document = tui.children?.[0];
  const chat = document?.children?.at(-1);
  const validAssistant = (child) => typeName(child) !== "AssistantMessageComponent" ||
    (child.lastMessage?.role === "assistant" && typeof child.hideThinkingBlock === "boolean" &&
      typeof child.hiddenThinkingLabel === "string" && typeof child.setHideThinkingBlock === "function" &&
      typeName(child.contentContainer) === "Container" && Array.isArray(child.contentContainer.children));
  if (typeName(document) !== "Container" || typeName(chat) !== "Container" || !Array.isArray(chat.children) ||
      typeof chat.render !== "function" || !chat.children.every((child) => typeof child.render === "function" && validAssistant(child))) return;
  const original = chat.render;
  try {
    const lines = original.call(chat, Math.max(1, tui.terminal.columns));
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) return;
  } catch { return; }
  const isNotice = (child) => ["ThemedText", "Text"].includes(typeName(child));
  const noticeText = (child) => p.stripTerminalSequences(String(child.text ?? ""));
  const initialNotices = new WeakMap(chat.children.filter(isNotice).map((child) => [child, noticeText(child)]));
  const previousMouseLayout = chat.mouseLayout;
  let ownedMouseLayout;
  const thinking = new Map();
  let disposed = false;
  const restore = (child, previous) => {
    if (child.hideThinkingBlock === true) child.setHideThinkingBlock(previous);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (chat.render === wrapper) {
      chat.render = original;
      if (ownedMouseLayout && chat.mouseLayout === ownedMouseLayout) chat.mouseLayout = previousMouseLayout;
      for (const [child, previous] of thinking) if (chat.children.includes(child)) restore(child, previous);
    }
    thinking.clear();
    tui.requestRender(true);
  };
  const renderFiltered = function (width) {
    if (disposed) return original.call(this, width);
    for (const child of thinking.keys()) if (!this.children.includes(child)) thinking.delete(child);
    if (!this.children.every((child) => typeof child.render === "function" && validAssistant(child))) {
      dispose();
      queueMicrotask(unavailable);
      return original.call(this, width);
    }
    const lines = [], mouseChildren = [];
    for (const child of this.children) {
      const kind = typeName(child);
      // Pi reuses its last status component for consecutive notices. Rendering
      // hydrates ThemedText; compare unwrapped prose so theme/width changes do
      // not reveal an unchanged earlier notice.
      const noticeLines = isNotice(child) ? child.render(width) : undefined;
      const freshNotice = noticeLines && (!initialNotices.has(child) || initialNotices.get(child) !== noticeText(child));
      const keep = kind === "UserMessageComponent" || kind === "CompactionSummaryMessageComponent" ||
        freshNotice ||
        (kind === "CustomEntryComponent" && child.entry?.customType === RECAP_ENTRY_TYPE) ||
        (kind === "AssistantMessageComponent" && rarebitMetadata({ type: "message", message: child.lastMessage }) !== null);
      if (keep && kind === "AssistantMessageComponent" && !thinking.has(child)) {
        thinking.set(child, child.hideThinkingBlock);
        child.setHideThinkingBlock(true);
      }
      let childLines = [];
      if (keep && kind === "AssistantMessageComponent") {
        // Pi renders selected prose as Markdown. Thinking placeholders are
        // separate Text children (wrapped by MouseRegion on newer Pi). Exclude
        // those components only while rendering; never compare prose to a label.
        const content = child.contentContainer;
        const originalChildren = content.children;
        const blocks = child.lastMessage.content;
        const hasThinking = blocks.some((block) => block.type === "thinking" && block.thinking.trim());
        const thinkingChrome = (part) => typeName(part) === "Text" ||
          (typeName(part) === "MouseRegion" && typeName(part.child) === "Text");
        const filtered = hasThinking ? originalChildren.filter((part) => !thinkingChrome(part)) : originalChildren;
        const proseBlocks = blocks.filter((block) => block.type === "text" && block.text.trim()).length;
        if (filtered.some((part) => !["Markdown", "Spacer"].includes(typeName(part))) ||
            filtered.filter((part) => typeName(part) === "Markdown").length !== proseBlocks)
          throw new Error("Pi assistant content structure changed");
        content.children = filtered;
        try { childLines = child.render(width); }
        finally { if (content.children === filtered) content.children = originalChildren; }
      } else if (keep) childLines = noticeLines ?? child.render(width);
      if (!Array.isArray(childLines) || !childLines.every((line) => typeof line === "string")) throw new Error("Pi transcript render shape changed");
      if (keep && kind === "AssistantMessageComponent") {
        const plain = (line) => p.stripTerminalSequences(line).trim();
        while (childLines.length && !plain(childLines[0])) childLines.shift();
        while (childLines.length && !plain(childLines.at(-1))) childLines.pop();
      }
      if (childLines.length && lines.length) childLines = ["", ...childLines];
      mouseChildren.push({ component: child, height: childLines.length });
      lines.push(...childLines);
    }
    if ("mouseLayout" in this) this.mouseLayout = ownedMouseLayout = { width, children: mouseChildren };
    return lines;
  };
  const wrapper = function (width) {
    try { return renderFiltered.call(this, width); }
    catch {
      dispose();
      queueMicrotask(unavailable);
      return original.call(this, width);
    }
  };
  chat.render = wrapper;
  return dispose;
}

/** Session-scoped display controller. No Session writes or model operations. */
export function createRarebitViewController() {
  let preferred = "all", active, activation, epoch = 0;
  const notify = (ctx, message) => ctx?.hasUI && ctx.ui.notify?.(message, "warning");
  const stop = () => {
    epoch++;
    const old = activation;
    activation = undefined;
    active = undefined;
    try { old?.dispose?.(); }
    finally {
      old?.ctx.ui.setStatus?.("rarebit-view", undefined);
      old?.tui?.requestRender(true);
    }
  };
  const activate = async (ctx, mode) => {
    stop();
    if (ctx?.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
      notify(ctx, "Rarebit view is unavailable on this Pi version");
      return;
    }
    preferred = mode;
    const token = epoch;
    const record = { ctx, dispose: () => {} };
    activation = record;
    const current = () => token === epoch && activation === record;
    try {
      const p = await loadPeers();
      if (!current()) return;
      for (const name of ["Markdown", "matchesKey", "decodeKittyPrintable", "sliceByColumn", "stripTerminalSequences", "truncateToWidth", "visibleWidth", "getMarkdownTheme"])
        if (typeof p[name] !== "function") throw new Error("unavailable");
      if (typeof ctx.sessionManager?.getBranch !== "function") throw new Error("unavailable");
      const markActive = (tui) => {
        if (!current()) return;
        record.tui = tui;
        active = mode;
        ctx.ui.setStatus?.("rarebit-view", `Rarebit view: ${mode} · next ${CYCLE_KEYS[0]} · off ${TOGGLE_KEYS[0]}`);
        tui.requestRender(true);
      };
      const fallback = () => {
        if (!current()) return;
        notify(ctx, "Context view is unavailable on this Pi version; showing all.");
        void activate(ctx, "all");
      };
      if (mode === "context") {
        let tui;
        await ctx.ui.custom((host, _theme, _kb, done) => {
          tui = host;
          done();
          return { render: () => [], invalidate() {} };
        });
        if (!current()) return;
        const dispose = tui && tryAttach(tui, p, fallback);
        if (!dispose) return fallback();
        record.dispose = dispose;
        markActive(tui);
        return;
      }
      let close, timer;
      const ready = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("unavailable")), 1000);
        record.dispose = () => { clearTimeout(timer); close?.(); resolve(); };
        const pending = ctx.ui.custom((tui, theme, _kb, done) => {
          close = done;
          if (!current()) done();
          if (typeof tui.showOverlay !== "function" || typeof theme.inverse !== "function") throw new Error("unavailable");
          record.tui = tui;
          return new RarebitPane(tui, theme, ctx, mode, p, {
            close: stop, toggle: () => void controller.toggle(ctx), cycle: () => void controller.cycle(ctx),
          });
        }, {
          overlay: true,
          overlayOptions: { row: 0, col: 0, width: "100%", maxHeight: "100%", nonCapturing: mode === "peek" },
          onHandle: (handle) => {
            if (!current()) { close?.(); return resolve(); }
            if (typeof handle.isFocused !== "function" || (mode === "peek" && handle.isFocused())) return reject(new Error("unavailable"));
            clearTimeout(timer);
            markActive(record.tui);
            resolve();
          },
        });
        Promise.resolve(pending).then(() => { if (current()) stop(); resolve(); }, reject);
      });
      await ready;
    } catch {
      if (current()) { stop(); notify(ctx, "Rarebit view is unavailable on this Pi version"); }
    }
  };
  const controller = {
    get activeMode() { return active ?? "off"; },
    async command(ctx, mode) {
      if (mode === "off") return stop();
      if (!mode) {
        stop();
        if (ctx?.mode !== "tui" || !ctx.hasUI) return;
        const token = epoch;
        const picked = await ctx.ui.select?.("Rarebit view", [
          "all — All Rarebits across compactions", "peek — All Rarebits with the editor live",
          "context — Current context only (experimental)", "off — Normal transcript",
        ]);
        if (token !== epoch || !picked) return;
        mode = picked.split(" ")[0];
      }
      if (MODES.includes(mode)) await activate(ctx, mode);
    },
    async toggle(ctx) { if (activation) stop(); else await activate(ctx, preferred); },
    async cycle(ctx) { await activate(ctx, MODES[(MODES.indexOf(preferred) + 1) % MODES.length]); },
    refresh() { activation?.tui?.requestRender(); },
    dispose: stop,
  };
  return controller;
}
