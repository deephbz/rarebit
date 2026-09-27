import {
  DEFAULT_RAREBIT_SUMMARY_POLICY,
  normalizeRarebitSummaryPrompt,
} from "./rarebit-core.mjs";

export const DEFAULT_RAREBIT_RECAP_DELAY_MS = 60_000;
export const DEFAULT_RAREBIT_RECAP_TIMEZONE = "host";
export const DEFAULT_RAREBIT_MAX_INPUT_TOKENS = 64_000;
export const MAX_RAREBIT_INPUT_TOKENS = Math.floor(Number.MAX_SAFE_INTEGER / 4);
export const DEFAULT_RAREBIT_DIAGNOSTICS = Object.freeze({
  summaryTriggered: false,
  summaryUpdated: false,
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRarebitRecapTimezone(value) {
  const candidate = nonEmptyString(value);
  if (!candidate || candidate === DEFAULT_RAREBIT_RECAP_TIMEZONE)
    return DEFAULT_RAREBIT_RECAP_TIMEZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_RAREBIT_RECAP_TIMEZONE;
  }
}

/**
 * Merge just the dedicated Rarebit namespace.  Pi's broader settings merge is
 * deliberately not reimplemented here: this boundary has only the small
 * nested objects whose inheritable fields must survive a Project override.
 */
export function mergeRarebitSettings(
  globalSettings = {},
  projectSettings = {},
) {
  const globalRarebit =
    isRecord(globalSettings?.rarebit)
      ? globalSettings.rarebit
      : {};
  const projectRarebit =
    isRecord(projectSettings?.rarebit)
      ? projectSettings.rarebit
      : {};
  const merged = { ...globalRarebit, ...projectRarebit };
  if (
    isRecord(globalRarebit.recap) &&
    isRecord(projectRarebit.recap)
  )
    merged.recap = { ...globalRarebit.recap, ...projectRarebit.recap };
  else if (isRecord(globalRarebit.recap) && !isRecord(projectRarebit.recap))
    merged.recap = globalRarebit.recap;
  if (
    isRecord(globalRarebit.diagnostics) &&
    isRecord(projectRarebit.diagnostics)
  )
    merged.diagnostics = {
      ...globalRarebit.diagnostics,
      ...projectRarebit.diagnostics,
    };
  else if (
    isRecord(globalRarebit.diagnostics) &&
    !isRecord(projectRarebit.diagnostics)
  )
    merged.diagnostics = globalRarebit.diagnostics;
  return merged;
}

export function modelFromRarebitSettings(rarebit) {
  const candidate = rarebit?.model;
  if (isRecord(candidate)) {
    const provider = nonEmptyString(candidate.provider);
    const id = nonEmptyString(candidate.id);
    if (provider && id) return { model: { provider, id } };
  }
  const spec = nonEmptyString(candidate);
  if (spec) {
    const separator = spec.indexOf("/");
    if (separator > 0 && separator < spec.length - 1)
      return {
        model: {
          provider: spec.slice(0, separator),
          id: spec.slice(separator + 1),
        },
      };
  }
  if (candidate === undefined)
    return { error: "Rarebit setting rarebit.model is missing" };
  return {
    error:
      "Rarebit setting rarebit.model must be provider/model or {provider,id}",
  };
}

/**
 * Pure configuration interpretation used identically by the interactive Pi
 * extension and the external CLI.  A caller supplies already-read global and
 * trusted-Project JSON objects; this function never reads files or falls back
 * to Pi's interactive default model.
 */
export function resolveRarebitSettings(
  globalSettings = {},
  projectSettings = {},
) {
  const rarebit = mergeRarebitSettings(globalSettings, projectSettings);
  const resolved = modelFromRarebitSettings(rarebit);
  const recap =
    isRecord(rarebit?.recap)
      ? rarebit.recap
      : {};
  const recapDelay = Number(recap.delay_ms);
  const recapEnabled = recap.enabled;
  const diagnostics =
    isRecord(rarebit?.diagnostics)
      ? rarebit.diagnostics
      : {};
  const summaryPrompt =
    rarebit.summary_prompt === undefined
      ? undefined
      : normalizeRarebitSummaryPrompt(rarebit.summary_prompt).guidance;
  // Preserve an explicitly invalid cap so the service rejects the request
  // before it can invoke a model. Only an omitted setting receives the safe
  // default.
  const maxInputTokens =
    rarebit.max_input_tokens === undefined
      ? DEFAULT_RAREBIT_MAX_INPUT_TOKENS
      : Number(rarebit.max_input_tokens);
  return {
    ...(resolved.model ? { model: resolved.model } : {}),
    ...(resolved.error ? { modelConfigurationError: resolved.error } : {}),
    summaryPolicy: {
      ...DEFAULT_RAREBIT_SUMMARY_POLICY,
      ...(rarebit.min_total_length === undefined
        ? {}
        : { minTotalLength: Number(rarebit.min_total_length) }),
      ...(rarebit.max_rarebit_ratio === undefined
        ? {}
        : { maxRarebitRatio: Number(rarebit.max_rarebit_ratio) }),
    },
    autoTitle: rarebit.auto_title !== false,
    ...(summaryPrompt === undefined ? {} : { summaryPrompt }),
    maxInputTokens,
    diagnostics: {
      summaryTriggered: diagnostics.summary_triggered === true,
      summaryUpdated: diagnostics.summary_updated === true,
    },
    recap: {
      enabled: recapEnabled !== false,
      delayMs:
        Number.isSafeInteger(recapDelay) && recapDelay >= 0
          ? recapDelay
          : DEFAULT_RAREBIT_RECAP_DELAY_MS,
      timezone: normalizeRarebitRecapTimezone(recap.timezone),
    },
  };
}
