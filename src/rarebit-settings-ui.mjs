import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  DEFAULT_RAREBIT_MAX_INPUT_TOKENS,
  MAX_RAREBIT_INPUT_TOKENS,
  DEFAULT_RAREBIT_RECAP_DELAY_MS,
  modelFromRarebitSettings,
} from "./rarebit-settings.mjs";
import {
  DEFAULT_RAREBIT_SUMMARY_PROMPT_GUIDANCE,
  normalizeRarebitSummaryPrompt,
} from "./rarebit-core.mjs";

// This module owns Rarebit's human-only command palette and settings editor.
// It edits only the `rarebit` namespace in Pi settings. Model turns, Session
// records, and existing Teams remain outside this boundary.

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const HOST_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "host";
let tuiPrimitives;

async function loadTuiPrimitives() {
  if (!tuiPrimitives) tuiPrimitives = await import("@earendil-works/pi-tui");
  return tuiPrimitives;
}

export const RAREBIT_SETTINGS_TABS = Object.freeze([
  "Actions",
  "Summary",
  "Recap",
  "Session",
]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const record = (value) => (isRecord(value) ? value : {});

const clean = (value) => String(value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

const getPath = (value, path) => path.reduce((current, key) => record(current)[key], value);

function setPath(root, path, value) {
  if (!path.length) return;
  const [key, ...rest] = path;
  if (!rest.length) {
    if (value === undefined) delete root[key];
    else root[key] = value;
    return;
  }
  if (value === undefined && !isRecord(root[key])) return;
  root[key] = { ...record(root[key]) };
  setPath(root[key], rest, value);
  if (isRecord(root[key]) && Object.keys(root[key]).length === 0) delete root[key];
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readSettingsFile(file) {
  let handle;
  try {
    try {
      if ((await lstat(file)).isSymbolicLink())
        throw new Error("Pi settings must not be a symbolic link.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const flags = fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(file, flags);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_SETTINGS_BYTES)
      throw new Error("Pi settings must be a regular file no larger than 2 MiB.");
    const bytes = await handle.readFile();
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Pi settings contain malformed JSON.");
    }
    if (!isRecord(parsed)) throw new Error("Pi settings root must be an object.");
    return { root: parsed, bytes, mode: metadata.mode & 0o777, revision: digest(bytes) };
  } catch (error) {
    if (error?.code === "ENOENT") return { root: {}, bytes: Buffer.from("{}"), mode: 0o600, revision: "missing" };
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function settingsFile({ cwd = process.cwd(), agentDir, scope }) {
  const resolvedAgentDir = resolve(agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
  return scope === "project"
    ? join(resolve(cwd), ".pi", "settings.json")
    : join(resolvedAgentDir, "settings.json");
}

export async function readRarebitSettingsDocument({
  cwd = process.cwd(),
  agentDir,
  scope = "global",
  projectTrusted = false,
} = {}) {
  if (scope === "project" && !projectTrusted)
    throw new Error("Project settings require a trusted Pi project.");
  const file = settingsFile({ cwd, agentDir, scope });
  const observed = await readSettingsFile(file);
  if (Object.hasOwn(observed.root, "rarebit") && !isRecord(observed.root.rarebit))
    throw new Error("Pi settings rarebit namespace must be a JSON object.");
  return {
    file,
    scope,
    namespace: isRecord(observed.root.rarebit) ? observed.root.rarebit : {},
    revision: observed.revision,
    mode: observed.mode,
  };
}

async function withLock(file, operation) {
  // Pi's FileSettingsStorage uses <settings>.lock. Share that lock directory
  // so an editor does not race a native Pi settings write.
  const lock = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true });
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
    if (!acquired) throw new Error("Another Rarebit settings editor is saving; retry.");
    return await operation();
  } finally {
    if (acquired) await rm(lock, { recursive: true, force: true }).catch(() => {});
  }
}

export async function saveRarebitSettingsDocument(document, namespace, { isCurrent } = {}) {
  if (!document || (document.scope === "project" && !document.file))
    throw new Error("Rarebit settings document is unavailable.");
  if (!isRecord(namespace)) throw new Error("Rarebit settings must be a JSON object.");
  const serializedNamespace = JSON.stringify(namespace);
  if (Buffer.byteLength(serializedNamespace, "utf8") > MAX_SETTINGS_BYTES)
    throw new Error("Rarebit settings exceed the 2 MiB editor limit.");
  return withLock(document.file, async () => {
    const current = await readSettingsFile(document.file);
    if (current.revision !== document.revision)
      throw new Error("Pi settings changed after they were opened. Reload before saving.");
    if (typeof isCurrent === "function" && !isCurrent())
      throw new Error("The Pi Session changed. Reopen Rarebit settings before saving.");
    const updated = { ...current.root, rarebit: JSON.parse(serializedNamespace) };
    const bytes = Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_SETTINGS_BYTES)
      throw new Error("Pi settings would exceed the 2 MiB editor limit.");
    const temporary = join(dirname(document.file), `.${basename(document.file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, bytes, { mode: current.mode || 0o600, flag: "wx" });
      if (current.mode) await chmod(temporary, current.mode).catch(() => {});
      if (typeof isCurrent === "function" && !isCurrent())
        throw new Error("The Pi Session changed. Reopen Rarebit settings before saving.");
      await rename(temporary, document.file);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return { ...document, namespace: JSON.parse(serializedNamespace), revision: digest(bytes), mode: current.mode };
  });
}

const field = (id, tab, label, path, kind, description, options = {}) => ({
  id,
  tab,
  label,
  path,
  kind,
  description,
  ...options,
});

export const RAREBIT_SETTINGS_FIELDS = Object.freeze([
  field("summary_triggered_diagnostics", "Summary", "Show Summary triggered", ["diagnostics", "summary_triggered"], "boolean", "Show the Summary triggered diagnostic in the TUI. Warnings and errors always remain visible.", { defaultValue: false }),
  field("summary_updated_diagnostics", "Summary", "Show Summary updated", ["diagnostics", "summary_updated"], "boolean", "Show the Summary updated diagnostic in the TUI. Warnings and errors always remain visible.", { defaultValue: false }),
  field("max_input_tokens", "Summary", "Summary input cap", ["max_input_tokens"], "number", "Maximum Summary input in estimated tokens. The implementation bounds the prompt at about four UTF-16 characters per token.", { defaultValue: DEFAULT_RAREBIT_MAX_INPUT_TOKENS, min: 1, max: MAX_RAREBIT_INPUT_TOKENS }),
  field("summary_prompt", "Summary", "Summary prompt", ["summary_prompt"], "multiline", "Optional multiline guidance for Summary prose. The fixed evidence and JSON status contract remains unchanged.", { defaultValue: DEFAULT_RAREBIT_SUMMARY_PROMPT_GUIDANCE }),
  field("min_total_length", "Summary", "Automatic Summary threshold", ["min_total_length"], "number", "Minimum Session prose length in estimated tokens before automatic Summary synthesis.", { defaultValue: 80_000, min: 0 }),
  field("max_rarebit_ratio", "Summary", "Maximum Rarebit ratio", ["max_rarebit_ratio"], "ratio", "Maximum selected Rarebit prose ratio for automatic Summary synthesis.", { defaultValue: 0.4, min: 0, max: 1 }),
  field("recap_enabled", "Recap", "Recap widget", ["recap", "enabled"], "boolean", "Show the human-only Recap widget after a current Summary is available.", { defaultValue: true }),
  field("recap_delay_ms", "Recap", "Recap delay (ms)", ["recap", "delay_ms"], "number", "Delay before the human-only Recap widget appears.", { defaultValue: DEFAULT_RAREBIT_RECAP_DELAY_MS, min: 0 }),
  field("recap_timezone", "Recap", "Recap timezone", ["recap", "timezone"], "timezone", `Timestamp zone. Blank uses the host timezone (${HOST_TIMEZONE}).`, { defaultValue: HOST_TIMEZONE }),
  field("auto_title", "Session", "Automatic Session title", ["auto_title"], "boolean", "Generate a Rarebit title from the first persisted owner message.", { defaultValue: true }),
  field("model", "Session", "Rarebit model", ["model"], "string", "Model in provider/model form. Blank removes the local override.", { defaultValue: "Not set" }),
]);

const paletteItems = [
  { id: "settings", tab: "Actions", label: "Settings", description: "Open the interactive Rarebit settings editor." },
  { id: "status", tab: "Actions", label: "Status", description: "Show effective Rarebit configuration." },
  { id: "help", tab: "Actions", label: "Command help", description: "Show direct /rarebit commands." },
  { id: "summarize", tab: "Actions", label: "Summarize", description: "Force a Rarebit Summary materialization." },
  { id: "recall", tab: "Actions", label: "Recall", description: "Recall active-branch Rarebit messages with a prompt." },
  { id: "fork", tab: "Actions", label: "Fork", description: "Open a bounded Rarebit fork without a model turn." },
  { id: "summary_status", tab: "Summary", label: "Summary status", description: "Show effective Summary policy." },
  { id: "summary_settings", tab: "Summary", label: "Summary settings", description: "Edit Summary diagnostics and input policy." },
  { id: "recap", tab: "Recap", label: "Recap", description: "Show the current Recap in the TUI." },
  { id: "recap_settings", tab: "Recap", label: "Recap settings", description: "Edit Recap display and timestamp settings." },
  { id: "title", tab: "Session", label: "Title Session", description: "Generate a title for the active Session." },
  { id: "session_settings", tab: "Session", label: "Session settings", description: "Edit model and automatic title settings." },
];

function key(data, expected, primitives) {
  const { Key, matchesKey } = primitives;
  if (expected === "escape") return matchesKey(data, Key.escape);
  if (expected === "tab") return matchesKey(data, Key.tab);
  if (expected === "shiftTab") return matchesKey(data, Key.shift(Key.tab));
  if (expected === "up") return matchesKey(data, Key.up) || data === "k";
  if (expected === "down") return matchesKey(data, Key.down) || data === "j";
  if (expected === "enter") return matchesKey(data, Key.enter);
  return false;
}

function createTabbedComponent({ title, tabs, items, initialTab, current, isCurrent, scopeLine }, host, theme, done, primitives) {
  let activeTab = initialTab ?? tabs[0];
  let selectedIndex = 0;
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    done(isCurrent() ? value : undefined);
  };
  const visible = () => items.filter((item) => item.tab === activeTab);
  const selectTab = (step) => {
    const index = tabs.indexOf(activeTab);
    activeTab = tabs[(index + step + tabs.length) % tabs.length];
    selectedIndex = 0;
    host.requestRender(true);
  };
  return {
    render(width) {
      const rows = visible();
      const selected = rows[selectedIndex];
      const rule = theme.fg?.("borderMuted", "─".repeat(Math.max(0, width))) ?? "─".repeat(Math.max(0, width));
      const tabLine = tabs.map((tab) => tab === activeTab
        ? (theme.fg?.("accent", theme.bold?.(tab) ?? tab) ?? tab)
        : (theme.fg?.("dim", tab) ?? tab)).join(theme.fg?.("dim", "  /  ") ?? "  /  ");
      const output = [
        rule,
        theme.fg?.("accent", theme.bold?.(`  ${title}`) ?? `  ${title}`) ?? `  ${title}`,
        ...(scopeLine ? [theme.fg?.("dim", `  ${scopeLine}`) ?? `  ${scopeLine}`] : []),
        "",
        `  ${tabLine}`,
        rule,
      ];
      for (const [index, item] of rows.entries()) {
        const marker = index === selectedIndex ? "→ " : "  ";
        const value = current?.(item) ?? "Open";
        output.push(`${marker}${item.label}: ${value}`);
      }
      if (selected) output.push(theme.fg?.("dim", `  ${selected.description}`) ?? `  ${selected.description}`);
      output.push(theme.fg?.("dim", "  Tab/Shift+Tab sections · ↑/↓ rows · Enter choose · Esc cancel") ?? "  Tab/Shift+Tab sections · ↑/↓ rows · Enter choose · Esc cancel");
      output.push(rule);
      return output.map((line) => primitives.truncateToWidth(line, width, ""));
    },
    handleInput(data) {
      if (closed) return;
      if (!isCurrent() || key(data, "escape", primitives)) return close();
      if (key(data, "shiftTab", primitives)) return selectTab(-1);
      if (key(data, "tab", primitives)) return selectTab(1);
      const rows = visible();
      if (key(data, "up", primitives)) selectedIndex = (selectedIndex - 1 + rows.length) % Math.max(rows.length, 1);
      else if (key(data, "down", primitives)) selectedIndex = (selectedIndex + 1) % Math.max(rows.length, 1);
      else if (key(data, "enter", primitives)) close(rows[selectedIndex]);
      host.requestRender();
    },
    invalidate() {},
    dispose() { closed = true; },
  };
}

export async function openRarebitPalette(ctx, { isCurrent = () => true } = {}) {
  if (ctx?.mode !== "tui" || ctx?.hasUI === false || typeof ctx?.ui?.custom !== "function") return undefined;
  const primitives = await loadTuiPrimitives();
  return ctx.ui.custom((tui, theme, _keybindings, done) => createTabbedComponent({
    title: "Rarebit",
    tabs: RAREBIT_SETTINGS_TABS,
    items: paletteItems,
    isCurrent,
    scopeLine: "Human-only command palette. Selecting an action closes the palette before it runs.",
  }, { requestRender: (force) => tui.requestRender(force) }, theme, done, primitives));
}

function settingDisplay(fieldDefinition, namespace, scope, inherited) {
  const raw = getPath(namespace, fieldDefinition.path);
  const inheritedValue = getPath(inherited, fieldDefinition.path);
  const value = raw !== undefined
    ? raw
    : inheritedValue !== undefined
      ? inheritedValue
      : fieldDefinition.defaultValue;
  const source = raw !== undefined
    ? ` (${scope})`
    : inheritedValue !== undefined && scope === "project"
      ? " (inherited)"
      : fieldDefinition.defaultValue !== undefined
        ? " (default)"
        : "";
  if (value === undefined) return "Not set";
  if (fieldDefinition.kind === "boolean") return `${value ? "on" : "off"}${source}`;
  if (fieldDefinition.kind === "number" || fieldDefinition.kind === "ratio") {
    const rendered = fieldDefinition.kind === "ratio"
      ? String(value)
      : Number(value).toLocaleString();
    return `${rendered}${source}`;
  }
  if (fieldDefinition.kind === "multiline") {
    const rendered = clean(value).replace(/\s+/g, " ").trim();
    const preview = rendered.length > 96 ? `${rendered.slice(0, 93).trimEnd()}…` : rendered;
    return `${preview}${source}`;
  }
  if (fieldDefinition.kind === "timezone" && (value === "host" || value === HOST_TIMEZONE))
    return `${HOST_TIMEZONE}${source}`;
  if (fieldDefinition.kind === "string" && isRecord(value))
    return `${clean(value.provider)}/${clean(value.id)}${source}`;
  return `${clean(value)}${source}`;
}

function validateTimezone(value) {
  if (!value || value === "host") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

async function editField(ctx, fieldDefinition, namespace, inherited) {
  const raw = getPath(namespace, fieldDefinition.path);
  if (fieldDefinition.kind === "boolean") {
    const picked = await ctx.ui.select(fieldDefinition.label, [
      raw === true ? "on" : raw === false ? "off" : "Default",
      ...(raw === true || raw === undefined ? ["off"] : []),
      ...(raw === false || raw === undefined ? ["on"] : []),
      "Remove override",
    ]);
    if (picked === undefined) return undefined;
    if (picked === "Remove override" || picked === "Default") return { value: undefined };
    return { value: picked === "on" };
  }
  const displayedValue = fieldDefinition.kind === "multiline" && raw === undefined
    ? getPath(inherited, fieldDefinition.path) ?? fieldDefinition.defaultValue
    : raw;
  const displayed = displayedValue === undefined
    ? ""
    : fieldDefinition.kind === "string" && isRecord(displayedValue)
      ? `${clean(displayedValue.provider)}/${clean(displayedValue.id)}`
      : String(displayedValue);
  const prompt = `${fieldDefinition.label} (blank removes override)`;
  const entered = fieldDefinition.kind === "multiline" && typeof ctx.ui.editor === "function"
    ? await ctx.ui.editor(prompt, displayed)
    : await ctx.ui.input(prompt, displayed);
  if (entered === undefined) return undefined;
  if (entered.trim() === "") return { value: undefined };
  if (fieldDefinition.kind === "multiline") {
    return { value: normalizeRarebitSummaryPrompt(entered).guidance };
  }
  if (fieldDefinition.kind === "string" || fieldDefinition.kind === "timezone") {
    const value = entered.trim();
    if (fieldDefinition.kind === "timezone" && !validateTimezone(value)) throw new Error("Use a valid IANA timezone such as Asia/Hong_Kong, or leave it blank for the host timezone.");
    if (fieldDefinition.kind === "string") {
      const parsed = modelFromRarebitSettings({ model: value });
      if (parsed.error || !parsed.model) throw new Error(parsed.error ?? "Use a model in provider/model form.");
      return { value: `${parsed.model.provider}/${parsed.model.id}` };
    }
    return { value };
  }
  const numberValue = Number(entered);
  if (!Number.isSafeInteger(numberValue) && fieldDefinition.kind !== "ratio") throw new Error("Use a finite number.");
  if (!Number.isFinite(numberValue)) throw new Error("Use a finite number.");
  if (fieldDefinition.min !== undefined && numberValue < fieldDefinition.min) throw new Error(`Value must be at least ${fieldDefinition.min}.`);
  if (fieldDefinition.max !== undefined && numberValue > fieldDefinition.max) throw new Error(`Value must be at most ${fieldDefinition.max}.`);
  return { value: numberValue };
}

function fieldItems(scope, projectTrusted) {
  const scopeItem = { id: "scope", tab: "Actions", label: "Editing scope", description: "Choose the global Pi settings or the trusted project override.", values: projectTrusted ? ["global", "project"] : ["global"] };
  return [scopeItem, ...RAREBIT_SETTINGS_FIELDS];
}

export async function openRarebitSettings(ctx, {
  initialScope = "global",
  projectTrusted = ctx?.isProjectTrusted?.() === true,
  agentDir,
  isCurrent = () => true,
  onSaved,
} = {}) {
  if (ctx?.mode !== "tui" || ctx?.hasUI === false || typeof ctx?.ui?.custom !== "function") {
    ctx?.ui?.notify?.("Rarebit settings require interactive Pi.", "warning");
    return;
  }
  const primitives = await loadTuiPrimitives();
  if (initialScope === "project" && !projectTrusted) {
    ctx.ui.notify("Project settings require a trusted Pi project. No file was read or changed.", "warning");
    return;
  }
  let scope = initialScope === "project" && projectTrusted ? "project" : "global";
  let activeTab = "Summary";
  while (isCurrent()) {
    let document;
    let readError;
    try {
      document = await readRarebitSettingsDocument({ cwd: ctx.cwd, agentDir, scope, projectTrusted });
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    let inherited = {};
    if (scope === "project" && projectTrusted) {
      try { inherited = (await readRarebitSettingsDocument({ cwd: ctx.cwd, agentDir, scope: "global", projectTrusted: true })).namespace; } catch { inherited = {}; }
    }
    if (readError) {
      ctx.ui.notify(`Rarebit settings unavailable: ${readError}`, "error");
      return;
    }
    const selected = await ctx.ui.custom((tui, theme, _keybindings, done) => createTabbedComponent({
      title: "Rarebit Settings",
      tabs: RAREBIT_SETTINGS_TABS,
      items: fieldItems(scope, projectTrusted),
      initialTab: activeTab,
      isCurrent,
      scopeLine: `Editing ${scope} · ${document.file}`,
      current: (item) => item.id === "scope"
        ? scope
        : settingDisplay(item, document.namespace, scope, inherited),
    }, { requestRender: (force) => tui.requestRender(force) }, theme, done, primitives));
    if (!selected || !isCurrent()) return;
    activeTab = selected.tab;
    if (selected.id === "scope") {
      const picked = await ctx.ui.select("Editing scope", projectTrusted ? ["global", "project"] : ["global"]);
      if (picked === "project" && projectTrusted) scope = "project";
      else if (picked === "global") scope = "global";
      continue;
    }
    const fieldDefinition = RAREBIT_SETTINGS_FIELDS.find((candidate) => candidate.id === selected.id);
    if (!fieldDefinition) continue;
    try {
      const edit = await editField(ctx, fieldDefinition, document.namespace, inherited);
      if (!edit) continue;
      const next = structuredClone(record(document.namespace));
      setPath(next, fieldDefinition.path, edit.value);
      if (!await ctx.ui.confirm(`Save Rarebit ${scope} settings?`, `File: ${document.file}\nOnly the rarebit namespace will change.`)) continue;
      if (!isCurrent()) return;
      await saveRarebitSettingsDocument(document, next, { isCurrent });
      ctx.ui.notify(`Saved Rarebit ${scope} settings.`, "info");
      await onSaved?.({ scope, namespace: next, document });
    } catch (error) {
      ctx.ui.notify(`Rarebit settings were not saved: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
}

export function rarebitPaletteCommand(selection) {
  switch (selection?.id) {
    case "settings": case "summary_settings": case "recap_settings": case "session_settings": return "settings";
    case "summary_status": return "status";
    case "recap": return "recap";
    case "summarize": return "summarize";
    case "recall": return "recall";
    case "title": return "title";
    case "fork": return "fork";
    case "help": return "help";
    default: return undefined;
  }
}
