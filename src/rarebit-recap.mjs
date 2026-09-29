import { RECAP_ENTRY_TYPE, RECAP_READ_TYPE, latestRecap } from "./rarebit-read-checkpoint.mjs";
import { exactSelectionApplies } from "./rarebit-artifact-state.mjs";
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

function receiptAppliesToContext(receipt, ctx) {
  if (receipt?.status !== "ok") return false;
  const identity = sessionIdentity(ctx);
  if (!identity.sessionId || !identity.sessionFile) return false;
  if (receipt.sessionId !== identity.sessionId) return false;
  const branch = branchSnapshot(ctx);
  return exactSelectionApplies(receipt.selection, selectRarebits(branch));
}

function observedAtLabel(observedAt, timezone) {
  const date = new Date(observedAt);
  if (Number.isNaN(date.valueOf())) return String(observedAt ?? "unknown");
  const usesHostTimezone = timezone === DEFAULT_RAREBIT_RECAP_TIMEZONE;
  const dateOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(usesHostTimezone ? {} : { timeZone: timezone }),
  };
  let dateText;
  try {
    dateText = new Intl.DateTimeFormat(undefined, dateOptions).format(date);
  } catch {
    dateText = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  let zoneText;
  try {
    const zoneOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZoneName: "shortOffset",
      ...(usesHostTimezone ? {} : { timeZone: timezone }),
    };
    zoneText = new Intl.DateTimeFormat(undefined, zoneOptions)
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    zoneText = undefined;
  }
  let resolvedTimezone;
  try {
    resolvedTimezone = new Intl.DateTimeFormat(
      undefined,
      usesHostTimezone ? {} : { timeZone: timezone },
    ).resolvedOptions().timeZone;
  } catch {
    resolvedTimezone = undefined;
  }
  const zoneLabel = usesHostTimezone
    ? `host${resolvedTimezone ? `: ${resolvedTimezone}` : ""}`
    : resolvedTimezone ?? timezone;
  return `${dateText} (${zoneLabel}${zoneText ? `, ${zoneText}` : ""})`;
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
    })).then((components) => (loadedComponents = components));
  }
  return recapWidgetComponents;
}

function summaryContent(
  receipt,
  { timezone = DEFAULT_RAREBIT_RECAP_TIMEZONE } = {},
) {
  const presentation = rarebitSummaryPresentation(receipt.sessionStatus);
  const mark = presentation.mark ? `${presentation.mark} ` : "";
  const heading = `${mark}Recap · ${presentation.label} · as of ${observedAtLabel(receipt.observedAt, timezone)}`;
  const summary = String(receipt.summary ?? "").trim();
  return { heading, summary };
}

function recapComponent(content, theme) {
  const border = (text) => theme.fg("borderMuted", text);
  const widget = new loadedComponents.Container();
  const heading = new loadedComponents.Text("", 1, 0);
  const summary = new loadedComponents.Text("", 1, 0);
  let previousHeading;
  let previousSummary;
  const themed = (text, color, component, previous) => {
    const rendered = theme.fg(color, text);
    if (rendered !== previous.value) {
      previous.value = rendered;
      component.setText(rendered);
    }
  };
  const themedHeading = {
    render: (width) => {
      themed(content.heading, "dim", heading, previousHeading ??= {});
      return heading.render(width);
    },
    invalidate: () => {
      previousHeading = undefined;
      heading.invalidate();
    },
  };
  const themedSummary = {
    render: (width) => {
      themed(content.summary, "muted", summary, previousSummary ??= {});
      return summary.render(width);
    },
    invalidate: () => {
      previousSummary = undefined;
      summary.invalidate();
    },
  };
  widget.addChild(new loadedComponents.DynamicBorder(border));
  widget.addChild(themedHeading);
  widget.addChild(themedSummary);
  if (content.action) widget.addChild(new loadedComponents.Text(theme.fg("dim", content.action), 1, 0));
  widget.addChild(new loadedComponents.DynamicBorder(border));
  return widget;
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
    if (!receiptAppliesToContext(receipt, ctx)) return null;
    const artifactState = current?.artifactState;
    if (
      !["request_current", "assessment_current"].includes(
        artifactState?.syncState,
      ) ||
      !["request_generation", "exact_selection"].includes(
        artifactState?.applicability,
      ) ||
      artifactState?.receiptRef?.jobId !== receipt.jobId ||
      artifactState?.projection?.status !== receipt.sessionStatus
    )
      return null;
    return receipt;
  };

  const display = async (
    ctx,
    receipt,
    { timezone = recapTimezone, token, expectedOfferEpoch } = {},
  ) => {
    const target = tuiContext(ctx);
    if (!target || !receiptAppliesToContext(receipt, ctx)) return false;
    const observedControllerGeneration = controllerGeneration;
    const observedLifecycleGeneration = liveLifecycleGeneration;
    const observedOfferEpoch = expectedOfferEpoch ?? offerEpoch;
    const observedIdentity = sessionIdentity(ctx);
    try {
      await loadRecapWidgetComponents();
      if (
        observedControllerGeneration !== controllerGeneration ||
        observedLifecycleGeneration !== liveLifecycleGeneration ||
        observedOfferEpoch !== offerEpoch ||
        (token && !tokenIsCurrent(token)) ||
        !sameIdentity(observedIdentity, sessionIdentity(liveContext)) ||
        !receiptAppliesToContext(receipt, liveContext)
      )
        return false;
      const content = summaryContent(receipt, {
        timezone: normalizeRarebitRecapTimezone(timezone),
      });
      if (typeof appendEntry === "function") {
        const coveredEntryId = selectRarebits(branchSnapshot(ctx)).occurrences.at(-1)?.sourceEntryId;
        if (!coveredEntryId) return false;
        appendEntry(RECAP_ENTRY_TYPE, {
          version: 1, ...content, jobId: receipt.jobId,
          coveredEntryId, selectionHash: receipt.selection.manifestHash,
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
    const receipt = await readReceipt(ctx, options).catch(() => null);
    if (
      observedGeneration !== controllerGeneration ||
      observedOfferEpoch !== offerEpoch ||
      !sameIdentity(identity, sessionIdentity(liveContext))
    )
      return { shown: false, reason: "stale" };
    if (!receipt) {
      clearWidget(ctx);
      return { shown: false, reason: "no_current_summary" };
    }
    return {
      shown: await display(ctx, receipt, {
        timezone: options.timezone ?? options.recapTimezone ?? recapTimezone,
        expectedOfferEpoch: observedOfferEpoch,
      }),
      reason: "current_summary",
      receipt,
    };
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
      const receipt = await readReceipt(current, offerState.options).catch(
        () => null,
      );
      if (
        offerState.offerEpoch !== offerEpoch ||
        !tokenIsCurrent(offerState.token)
      )
        return;
      if (!receipt || receipt.jobId !== offerState.record.jobId) return;
      if (await display(current, receipt, {
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
        const read = branchSnapshot(liveContext).some((item) =>
          item.type === "custom" && item.customType === RECAP_READ_TYPE &&
          item.data?.recapEntryId === entry.id);
        component = recapComponent({ ...entry.data,
          action: read ? "✓ got it" : "[got it · Ctrl+Alt+G]" }, theme);
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
    if (branch.some((entry) => entry.type === "custom" && entry.customType === RECAP_READ_TYPE && entry.data?.recapEntryId === recap.id))
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
