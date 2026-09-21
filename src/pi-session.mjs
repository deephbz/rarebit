import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const DEFAULT_PI_SESSION_ROOT = join(
  homedir(),
  ".pi",
  "agent",
  "sessions",
);

function queryError(message) {
  const error = new Error(message);
  error.name = "PiSessionQueryError";
  return error;
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function* jsonlFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

async function readHeader(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(16384);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n", 1)[0]
      ?.trim();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine);
      return header?.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

function looksLikePath(reference) {
  return (
    reference.includes(sep) ||
    reference.startsWith(".") ||
    reference.endsWith(".jsonl")
  );
}

/** Resolve one exact path or one unambiguous persisted Session ID. */
export async function resolvePiSessionFile(
  reference,
  { sessionRoot = DEFAULT_PI_SESSION_ROOT } = {},
) {
  if (typeof reference !== "string" || !reference.trim())
    throw queryError("--session requires an exact Pi Session path or ID");
  const input = reference.trim();
  const path = resolve(input);
  if (await isRegularFile(path)) return path;
  if (looksLikePath(input))
    throw queryError(`Pi Session file not found: ${input}`);
  const matches = [];
  for await (const candidate of jsonlFiles(resolve(sessionRoot))) {
    const header = await readHeader(candidate);
    if (header?.id === input) matches.push(candidate);
  }
  if (matches.length === 0)
    throw queryError(`No persisted Pi Session has exact ID ${input}`);
  if (matches.length > 1)
    throw queryError(
      `Pi Session ID ${input} is ambiguous across ${matches.length} files; pass an exact path`,
    );
  return resolve(matches[0]);
}

/** Parse native JSONL without normalizing away unknown evidence fields. */
export function parseNativeSession(content, source = "Pi Session") {
  const records = [];
  for (const [index, line] of String(content).split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      throw queryError(`${source} contains malformed JSON at line ${index + 1}`);
    }
  }
  const header = records[0];
  if (
    !header ||
    header.type !== "session" ||
    typeof header.id !== "string" ||
    !header.id
  )
    throw queryError(`${source} does not begin with a valid Pi Session header`);
  const entries = records.slice(1);
  const version = header.version ?? 1;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    throw queryError(`${source} has an invalid Session version`);
  const byId = new Map();
  const linear = version < 2;
  if (!linear) {
    for (const entry of entries) {
      if (typeof entry?.id !== "string" || !entry.id)
        throw queryError(`${source} contains a Session entry without an ID`);
      if (byId.has(entry.id))
        throw queryError(
          `${source} contains duplicate Session entry ID ${entry.id}`,
        );
      byId.set(entry.id, entry);
    }
  }
  return { header, entries, byId, linear };
}

function ancestryFromLeaf(parsed, leaf, source) {
  const reversed = [];
  const visited = new Set();
  let current = leaf;
  while (current) {
    if (visited.has(current.id))
      throw queryError(`${source} contains a cycle at Session entry ${current.id}`);
    visited.add(current.id);
    reversed.push(current);
    if (current.parentId === null || current.parentId === undefined) break;
    if (typeof current.parentId !== "string" || !current.parentId)
      throw queryError(`${source} contains an invalid parent ID at ${current.id}`);
    current = parsed.byId.get(current.parentId);
    if (!current)
      throw queryError(
        `${source} is missing parent Session entry ${reversed.at(-1).parentId}`,
      );
  }
  return reversed.reverse();
}

/** Resolve the persisted active branch. The final entry is Pi's default leaf. */
export function resolveActiveBranch(parsed, source = "Pi Session") {
  if (parsed.linear) return parsed.entries.slice();
  const leaf = parsed.entries.at(-1);
  return leaf ? ancestryFromLeaf(parsed, leaf, source) : [];
}

/** Resolve one explicit leaf, or the native default leaf when omitted. */
export function resolveSessionBranch(
  parsed,
  { leafId = null } = {},
  source = "Pi Session",
) {
  if (parsed.linear) {
    if (leafId !== null && leafId !== undefined)
      throw queryError(
        `${source} uses a linear format and has no explicit branch leaf`,
      );
    return parsed.entries.slice();
  }
  const leaf =
    leafId === null || leafId === undefined
      ? parsed.entries.at(-1)
      : parsed.byId.get(leafId);
  if (!leaf) {
    if (leafId === null || leafId === undefined) return [];
    throw queryError(`${source} has no Session entry with leaf ID ${leafId}`);
  }
  return ancestryFromLeaf(parsed, leaf, source);
}

function childIds(parsed) {
  const children = new Set();
  if (parsed.linear) return children;
  for (const entry of parsed.entries) {
    if (entry.parentId !== null && entry.parentId !== undefined) {
      if (!parsed.byId.has(entry.parentId)) continue;
      children.add(entry.parentId);
    }
  }
  return children;
}

/** Return every persisted leaf in file order; no timestamp-based inference. */
export function listSessionBranches(parsed, source = "Pi Session") {
  if (parsed.linear) {
    return parsed.entries.length
      ? [{ leafId: null, entryCount: parsed.entries.length }]
      : [];
  }
  // Validate every connected component before looking for leaves. A cycle has
  // no leaf and must remain an explicit error instead of an empty branch list.
  for (const entry of parsed.entries) ancestryFromLeaf(parsed, entry, source);
  const children = childIds(parsed);
  return parsed.entries
    .filter((entry) => !children.has(entry.id))
    .map((entry) => ({
      leafId: entry.id,
      entryCount: ancestryFromLeaf(parsed, entry, source).length,
    }));
}

export async function readPiSession(reference, options = {}) {
  const sessionFile = await resolvePiSessionFile(reference, options);
  const parsed = parseNativeSession(
    await readFile(sessionFile, "utf8"),
    sessionFile,
  );
  const branch = resolveSessionBranch(
    parsed,
    { leafId: options.leafId ?? null },
    sessionFile,
  );
  return {
    sessionFile,
    parsed,
    branch,
    leafId: parsed.linear ? null : (branch.at(-1)?.id ?? null),
  };
}
