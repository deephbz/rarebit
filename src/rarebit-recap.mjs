import { RECAP_ENTRY_TYPE, RECAP_READ_TYPE, latestRecap, recapIsRead } from "./rarebit-read-checkpoint.mjs";
import { exactSelectionApplies, projectRarebitArtifactState } from "./rarebit-artifact-state.mjs";
import { selectRarebits } from "./rarebit-core.mjs";
import {
  DEFAULT_RAREBIT_RECAP_DELAY_MS,
  DEFAULT_RAREBIT_RECAP_TIMEZONE,
  normalizeRarebitRecapTimezone,
} from "./rarebit-settings.mjs";
import { readRarebitCurrent } from "./rarebit-store.mjs";
import { rarebitSummaryPresentation } from "./rarebit-visual-language.mjs";

export const RAREBIT_RECAP_WIDGET_KEY = "rarebit-recap";
export {
  DEFAULT_RAREBIT_RECAP_DELAY_MS,
  DEFAULT_RAREBIT_RECAP_TIMEZONE,
} from "./rarebit-settings.mjs";

function sessionIdentity(ctx) {
  return {
    sessionId: String(
      ctx?.sessionManager?.getHeader?.()?.id ?? ctx?.sessionId ?? "",
    ),
    sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? null,
  };
}

function branchSnapshot(ctx) {
  const branch = ctx?.sessionManager?.getBranch?.();
  return Array.isArray(branch) ? branch.slice() : [];
}

function receiptCoverage(receipt, ctx) {
  if (receipt?.status !== "ok") return { state: null, coverage: null };
  const identity = sessionIdentity(ctx);
  if (!identity.sessionId || !identity.sessionFile || receipt.sessionId !== identity.sessionId) return { state: null, coverage: null };
  const selection = selectRarebits(branchSnapshot(ctx));
  const current = projectRarebitArtifactState({
    native: { availability: "available", sessionId: identity.sessionId,
      selection: { ...selection, selectorVersion: selection.manifest.selectorVersion } },
    materialization: { availability: "available", records: [receipt] },
  });
  if (current.receiptRef?.jobId !== receipt.jobId ||
      !["request_current", "assessment_current"].includes(current.syncState)) return { state: current, coverage: null };
  if (current.applicability === "exact_selection" && exactSelectionApplies(receipt.selection, selection))
    return { state: current, coverage: { coveredEntryId: selection.occurrences.at(-1)?.sourceEntryId, selectionHash: receipt.selection.manifestHash } };
  if (current.applicability === "request_generation") {
    const covered = selection.occurrences[receipt.selection.occurrenceCount - 1];
    return { state: current, coverage: covered ? { coveredEntryId: covered.sourceEntryId, selectionHash: receipt.selection.manifestHash } : null };
  }
  return { state: current, coverage: null };
}

export function observedAtLabel(observedAt, timezone = DEFAULT_RAREBIT_RECAP_TIMEZONE) {
  if (observedAt === null || observedAt === undefined) return "unknown";
  const date = new Date(observedAt);
  if (Number.isNaN(date.valueOf())) return "unknown";
  const usesHostTimezone = timezone === DEFAULT_RAREBIT_RECAP_TIMEZONE;
  const options = usesHostTimezone ? {} : { timeZone: timezone };
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", ...options,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  let offset = "GMT";
  try {
    offset = new Intl.DateTimeFormat("en", { timeZoneName: "shortOffset", ...options })
      .formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  } catch {}
  return `${value("month")}/${value("day")} ${value("hour")}:${value("minute")}(${offset})`;
}

let recapWidgetComponents;
let loadedComponents;

async function loadRecapWidgetComponents() {
  if (!recapWidgetComponents) {
    recapWidgetComponents = Promise.all([
      import("@earendil-works/pi-tui"),
      import("@earendil-works/pi-coding-agent"),
    ]).then(([tui, agent]) => ({
      Container: tui.Container,
      Text: tui.Text,
      DynamicBorder: agent.DynamicBorder,
      truncateToWidth: tui.truncateToWidth,
      visibleWidth: tui.visibleWidth,
    })).then((components) => (loadedComponents = components));
  }
  return recapWidgetComponents;
}

function summaryContent(
  receipt,
  { timezone = DEFAULT_RAREBIT_RECAP_TIMEZONE } = {},
) {
  const presentation = rarebitSummaryPresentation(receipt.sessionStatus);
  const mark = presentation.mark ?? "";
  const heading = `${mark}Recap·${presentation.label.replaceAll(" ", "")}·${observedAtLabel(receipt.observedAt, timezone)}`;
  const summary = String(receipt.summary ?? "").trim();
  return { heading, summary };
}

function recapComponent(content, theme) {
  const border = (text) => theme.fg("borderMuted", text);
  const widget = new loadedComponents.Container();
  const summary = new loadedComponents.Text("", 1, 0);
  const compactSummary = new loadedComponents.Text("", 0, 0);
  let previousSummary;
  let previousCompactSummary;
  const themed = (text, color, component, previous) => {
    const rendered = theme.fg(color, text);
    if (rendered !== previous.value) {
      previous.value = rendered;
      component.setText(rendered);
    }
  };
  const themedHeading = {
    render(width) {
      const action = content.action
        ? loadedComponents.truncateToWidth(theme.fg("dim", content.action), Math.max(0, width), "")
        : "";
      const actionWidth = loadedComponents.visibleWidth(action);
      const heading = loadedComponents.truncateToWidth(
        theme.fg("dim", content.heading), Math.max(0, width - actionWidth), "",
      );
      return [`${heading}${action}`];
    },
    invalidate() {},
  };
  const themedSummary = {
    render(width) {
      if (width < 3) {
        themed(content.summary, "muted", compactSummary, previousCompactSummary ??= {});
        return compactSummary.render(width);
      }
      themed(content.summary, "muted", summary, previousSummary ??= {});
      return summary.render(width);
    },
    invalidate() {
      previousSummary = undefined;
      previousCompactSummary = undefined;
      summary.invalidate();
      compactSummary.invalidate();
    },
  };
  widget.addChild(new loadedComponents.DynamicBorder(border));
  widget.addChild(themedHeading);
  widget.addChild(themedSummary);
  widget.addChild(new loadedComponents.DynamicBorder(border));
  return {
    render(width) {
      const lines = widget.render(width);
      return width < 3
        ? lines.map((line) => loadedComponents.truncateToWidth(line, Math.max(0, width), ""))
        : lines;
    },
    invalidate() { widget.invalidate(); },
  };
}

function currentContextOptions(ctx, options) {
  return {
    sessionFile: sessionIdentity(ctx).sessionFile,
    ...(options?.sessionRoot ? { sessionRoot: options.sessionRoot } : {}),
    ...(options?.rarebitRoot ? { rarebitRoot: options.rarebitRoot } : {}),
    ...(options?.allowExternalSession === true
      ? { allowExternalSession: true }
      : {}),
  };
}

function sameIdentity(left, right) {
  return (
    left?.sessionId === right?.sessionId &&
    left?.sessionFile === right?.sessionFile
  );
}

/**
 * Private Pi-only presentation controller. It consumes existing receipts and
 * uses native custom entries for scrollable, human-only Recaps and read state.
 * Older Pi versions retain the widget fallback. It never invokes a model.
 */
export function createRarebitRecapController({
  delayMs = DEFAULT_RAREBIT_RECAP_DELAY_MS,
  timezone = DEFAULT_RAREBIT_RECAP_TIMEZONE,
  readCurrent = readRarebitCurrent,
  appendEntry,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0)
    throw new RangeError("Rarebit recap delay must be a nonnegative integer");
  const recapTimezone = normalizeRarebitRecapTimezone(timezone);

  let liveContext;
  let liveLifecycleGeneration = 0;
  let controllerGeneration = 0;
  let timer;
  let pending;
  let offerEpoch = 0;
  const displayedReceipts = new Set();

  const tuiContext = (ctx = liveContext) =>
    ctx?.mode === "tui" && typeof ctx?.ui?.setWidget === "function"
      ? ctx
      : null;

  const clearWidget = (ctx = liveContext) => {
    const target = tuiContext(ctx);
    if (!target) return;
    try {
      target.ui.setWidget(RAREBIT_RECAP_WIDGET_KEY, undefined, {
        placement: "aboveEditor",
      });
    } catch {
      // TUI rendering is best-effort and must not affect Summary materialization.
    }
  };

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeoutFn(timer);
    timer = undefined;
    pending = undefined;
    offerEpoch += 1;
  };

  const updateContext = (ctx, lifecycleGeneration) => {
    if (ctx) liveContext = ctx;
    if (Number.isSafeInteger(lifecycleGeneration))
      liveLifecycleGeneration = lifecycleGeneration;
  };

  const invalidate = (ctx, lifecycleGeneration) => {
    const previousContext = liveContext;
    clearWidget(previousContext);
    updateContext(ctx, lifecycleGeneration);
    controllerGeneration += 1;
    cancelTimer();
    clearWidget(ctx);
  };

  const captureMaterialization = (ctx) => {
    const snapshotGeneration = ctx?.rarebitLifecycleGeneration;
    if (
      Number.isSafeInteger(snapshotGeneration) &&
      snapshotGeneration !== liveLifecycleGeneration
    )
      return null;
    return {
      controllerGeneration,
      lifecycleGeneration: Number.isSafeInteger(snapshotGeneration)
        ? snapshotGeneration
        : liveLifecycleGeneration,
    };
  };

  const tokenIsCurrent = (token) =>
    Boolean(
      token &&
        token.controllerGeneration === controllerGeneration &&
        token.lifecycleGeneration === liveLifecycleGeneration,
    );

  const readReceipt = async (ctx, options) => {
    const identity = sessionIdentity(ctx);
    if (!identity.sessionFile) return null;
    const current = await readCurrent({
      ...currentContextOptions(ctx, options),
    });
    const receipt = current?.receipt;
    const artifactState = current?.artifactState;
    if (!receipt || !["request_current", "assessment_current"].includes(artifactState?.syncState) ||
        !["request_generation", "exact_selection"].includes(artifactState?.applicability) ||
        artifactState?.receiptRef?.jobId !== receipt.jobId ||
        artifactState?.projection?.status !== receipt.sessionStatus)
      return { receipt: null, reason: artifactState?.projection?.reason ?? artifactState?.retry?.reason ?? artifactState?.syncState ?? "no_summary" };
    const projection = receiptCoverage(receipt, ctx);
    return projection.coverage ? { receipt, coverage: projection.coverage } : {
      receipt: null, reason: projection.state?.retry?.reason ?? projection.state?.projection?.reason ?? projection.state?.syncState ?? "stale_or_divergent",
    };
  };

  const display = async (
    ctx,
    receipt,
    { timezone = recapTimezone, token, expectedOfferEpoch, storeOptions } = {},
  ) => {
    const target = tuiContext(ctx);
    let coverage = receiptCoverage(receipt, ctx).coverage;
    if (!target || !coverage) return false;
    const observedControllerGeneration = controllerGeneration;
    const observedLifecycleGeneration = liveLifecycleGeneration;
    const observedOfferEpoch = expectedOfferEpoch ?? offerEpoch;
    const observedIdentity = sessionIdentity(ctx);
    try {
      await loadRecapWidgetComponents();
      const current = await readReceipt(liveContext, storeOptions).catch(() => null);
      if (
        observedControllerGeneration !== controllerGeneration ||
        observedLifecycleGeneration !== liveLifecycleGeneration ||
        observedOfferEpoch !== offerEpoch ||
        (token && !tokenIsCurrent(token)) ||
        !sameIdentity(observedIdentity, sessionIdentity(liveContext)) ||
        !current?.receipt || current.receipt.jobId !== receipt.jobId ||
        current.coverage.coveredEntryId !== coverage.coveredEntryId ||
        current.coverage.selectionHash !== coverage.selectionHash
      )
        return false;
      receipt = current.receipt;
      coverage = current.coverage;
      const content = summaryContent(receipt, {
        timezone: normalizeRarebitRecapTimezone(timezone),
      });
      if (typeof appendEntry === "function") {
        const existing = branchSnapshot(ctx).findLast((entry) =>
          entry.type === "custom" && entry.customType === RECAP_ENTRY_TYPE &&
          entry.data?.version === 1 && entry.data.jobId === receipt.jobId &&
          entry.data.coveredEntryId === coverage.coveredEntryId &&
          entry.data.selectionHash === coverage.selectionHash);
        if (!existing) appendEntry(RECAP_ENTRY_TYPE, {
          version: 1, ...content, jobId: receipt.jobId,
          coveredEntryId: coverage.coveredEntryId, selectionHash: coverage.selectionHash,
        });
        return true;
      }
      target.ui.setWidget(
        RAREBIT_RECAP_WIDGET_KEY,
        (_tui, theme) => {
          return recapComponent(content, theme);
        },
        { placement: "aboveEditor" },
      );
      return true;
    } catch {
      return false;
    }
  };

  const showExisting = async (ctx, options = {}) => {
    controllerGeneration += 1;
    cancelTimer();
    updateContext(ctx);
    const observedGeneration = controllerGeneration;
    const observedOfferEpoch = offerEpoch;
    const identity = sessionIdentity(ctx);
    const current = await readReceipt(ctx, options).catch(() => null);
    if (
      observedGeneration !== controllerGeneration ||
      observedOfferEpoch !== offerEpoch ||
      !sameIdentity(identity, sessionIdentity(liveContext))
    )
      return { shown: false, reason: "stale" };
    if (!current?.receipt) {
      clearWidget(ctx);
      return { shown: false, reason: current?.reason ?? "no_current_summary" };
    }
    const shown = await display(ctx, current.receipt, {
      storeOptions: options,
      timezone: options.timezone ?? options.recapTimezone ?? recapTimezone,
      expectedOfferEpoch: observedOfferEpoch,
    });
    return { shown, reason: shown ? "current_summary" : "stale_or_unavailable", receipt: current.receipt };
  };

  const offer = ({ ctx, result, token, ...options }) => {
    const record = result?.record;
    if (
      !tuiContext() ||
      !tokenIsCurrent(token) ||
      record?.status !== "ok" ||
      typeof record.summary !== "string" ||
      !record.summary.trim() ||
      options.recapEnabled === false
    )
      return false;
    const key = `${record.sessionId}:${record.branch?.pathHash ?? ""}:${record.jobId}`;
    if (displayedReceipts.has(key) || pending?.key === key) return false;
    cancelTimer();
    const offeredIdentity = sessionIdentity(ctx);
    pending = {
      token,
      record,
      identity: offeredIdentity,
      options,
      key,
      offerEpoch: offerEpoch + 1,
    };
    offerEpoch = pending.offerEpoch;
    const fire = async () => {
      timer = undefined;
      const offerState = pending;
      pending = undefined;
      if (
        !offerState ||
        offerState.offerEpoch !== offerEpoch ||
        !tokenIsCurrent(offerState.token)
      )
        return;
      const current = liveContext;
      const currentIdentity = sessionIdentity(current);
      if (!sameIdentity(offerState.identity, currentIdentity)) return;
      const currentReceipt = await readReceipt(current, offerState.options).catch(
        () => null,
      );
      if (
        offerState.offerEpoch !== offerEpoch ||
        !tokenIsCurrent(offerState.token)
      )
        return;
      if (!currentReceipt?.receipt || currentReceipt.receipt.jobId !== offerState.record.jobId) return;
      if (await display(current, currentReceipt.receipt, {
        storeOptions: offerState.options,
        token: offerState.token,
        expectedOfferEpoch: offerState.offerEpoch,
        timezone:
          offerState.options.timezone ??
          offerState.options.recapTimezone ??
          recapTimezone,
      })) {
        displayedReceipts.add(offerState.key);
        if (displayedReceipts.size > 128)
          displayedReceipts.delete(displayedReceipts.values().next().value);
      }
    };
    timer = setTimeoutFn(fire, options.recapDelayMs ?? delayMs);
    timer?.unref?.();
    return true;
  };

  const renderEntry = (entry, _options, theme) => {
    if (entry.data?.version !== 1 || typeof entry.data.summary !== "string" ||
        typeof entry.data.heading !== "string") return undefined;
    let component;
    // Resume can render entries before the optional Pi imports settle. Keep a
    // placeholder while the optional components load, then request a redraw.
    if (!loadedComponents)
      void loadRecapWidgetComponents().then(() => clearWidget()).catch(() => {});
    return {
      render(width) {
        if (!loadedComponents) return [theme.fg("dim", "Recap loading…".slice(0, width))];
        const read = recapIsRead(branchSnapshot(liveContext), entry);
        component = recapComponent({ ...entry.data,
          action: read ? " ✓ got it" : " [got it]" }, theme);
        return component.render(width);
      },
      invalidate() { component?.invalidate(); },
    };
  };

  const acknowledge = (ctx) => {
    if (typeof appendEntry !== "function" || !sameIdentity(sessionIdentity(ctx), sessionIdentity(liveContext)))
      return { acknowledged: false, reason: "unavailable" };
    const branch = branchSnapshot(ctx);
    const recap = latestRecap(branch);
    if (!recap) return { acknowledged: false, reason: "no_recap" };
    if (recapIsRead(branch, recap))
      return { acknowledged: false, reason: "already_read" };
    appendEntry(RECAP_READ_TYPE, { version: 1, recapEntryId: recap.id,
      jobId: recap.data.jobId, coveredEntryId: recap.data.coveredEntryId,
      selectionHash: recap.data.selectionHash });
    clearWidget(ctx);
    return { acknowledged: true };
  };

  const dispose = () => {
    invalidate(undefined, undefined);
    liveContext = undefined;
  };

  return {
    renderEntry,
    acknowledge,
    captureMaterialization,
    offer,
    showExisting,
    updateContext,
    invalidate,
    dispose,
  };
}
