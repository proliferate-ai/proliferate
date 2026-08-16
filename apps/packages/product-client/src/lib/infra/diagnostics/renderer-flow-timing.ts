import {
  diagnosticField,
  recordRendererDiagnostic,
  type RendererDiagnosticCorrelation,
  type RendererDiagnosticField,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

/**
 * Canonical renderer flow-timing marks (UX Latency + Transitions ADR §4.8,
 * Rung 1, Q17).
 *
 * This module is the single producer of the `renderer.flow.*` event family. It
 * sits alongside the existing renderer connection/stream diagnostics
 * (renderer-diagnostics-connection.ts, renderer-diagnostic-migrations.ts) and is
 * the one place the four canonical UX flows (workspace_open, settings_nav,
 * terminal_attach, session_open) emit stage timings. The older
 * `logLatency(...)` latency-flow API and the `startMeasurementOperation(...)`
 * measurement-port operation are no longer wired to these four flows; only
 * genuinely out-of-scope probes (typing/jank/scroll, incremental history
 * append/prepend, etc.) still use those APIs.
 *
 * The three stage timings the ADR requires:
 *
 *   - intent_to_shell_ms  (intent      -> shell_committed)
 *   - shell_to_data_ms    (shell        -> data_ready)
 *   - data_to_stable_ms   (data_ready   -> content_stable)
 *
 * IMPORTANT: these marks are store/data-boundary proxies, not real paint
 * commits. `shell_committed` fires when the shell's store state is in place and
 * `content_stable` when the surface's data has settled at the boundary this code
 * can observe; neither is a measured browser paint. A later rung that binds
 * treatments to a budget should account for the paint gap they do not capture.
 *
 * Budgets stay measurement-validated DRAFTS: each flow names a metric with a
 * threshold slot, but `thresholdMs` is null (unenforced) until treatments bind
 * to a measured budget in a later rung.
 *
 * Marks are additive: reverting this rung is deleting the mark call sites, with
 * no ordering or treatment change.
 */

export type RendererFlowKind =
  | "workspace_open"
  | "settings_nav"
  | "terminal_attach"
  | "session_open";

export type RendererFlowStage =
  | "intent"
  | "shell_committed"
  | "data_ready"
  | "content_stable";

/** Extra operational fields a call site may attach to a stage mark. */
export type RendererFlowDetail = Record<string, string | number | boolean | null>;

/**
 * Settings navigation is a singleton surface (one settings screen at a time),
 * so its flow uses a fixed correlation key shared by the nav command that opens
 * it and the screen that settles it.
 */
export const SETTINGS_NAV_FLOW_KEY = "settings";

export interface RendererFlowBudget {
  /** Metric name a later rung binds a treatment to. */
  metric: string;
  /** null = measurement-validated draft; no number is enforced this rung. */
  thresholdMs: number | null;
}

export const RENDERER_FLOW_BUDGETS: Record<RendererFlowKind, RendererFlowBudget> = {
  workspace_open: {
    metric: "renderer.flow.workspace_open.data_to_stable_ms",
    thresholdMs: null,
  },
  settings_nav: {
    metric: "renderer.flow.settings_nav.data_to_stable_ms",
    thresholdMs: null,
  },
  terminal_attach: {
    metric: "renderer.flow.terminal_attach.data_to_stable_ms",
    thresholdMs: null,
  },
  session_open: {
    metric: "renderer.flow.session_open.data_to_stable_ms",
    thresholdMs: null,
  },
};

interface RendererFlowState {
  kind: RendererFlowKind;
  correlation: RendererDiagnosticCorrelation;
  startedAt: number;
  shellAt: number | null;
  dataAt: number | null;
  stages: Set<RendererFlowStage>;
}

const FLOW_MAX_AGE_MS = 5 * 60 * 1000;
const activeFlows = new Map<string, RendererFlowState>();

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function flowKey(kind: RendererFlowKind, correlationKey: string): string {
  return `${kind}:${correlationKey}`;
}

function pruneStaleFlows(now: number): void {
  for (const [key, flow] of activeFlows) {
    if (now - flow.startedAt > FLOW_MAX_AGE_MS) {
      activeFlows.delete(key);
    }
  }
}

function detailFields(
  detail: RendererFlowDetail | undefined,
): Record<string, RendererDiagnosticField> {
  if (!detail) {
    return {};
  }
  const fields: Record<string, RendererDiagnosticField> = {};
  for (const [key, value] of Object.entries(detail)) {
    fields[key] = diagnosticField(value, "operational");
  }
  return fields;
}

/**
 * Open a flow at intent and emit `renderer.flow.intent`. Idempotent per
 * (kind, correlationKey): a re-begin restarts the clock, matching the old
 * latency-flow "intent restarts on re-entry" behavior.
 */
export function beginRendererFlow(input: {
  kind: RendererFlowKind;
  correlationKey: string;
  correlation?: RendererDiagnosticCorrelation;
}): void {
  const now = nowMs();
  pruneStaleFlows(now);
  const correlation = input.correlation ?? {};
  activeFlows.set(flowKey(input.kind, input.correlationKey), {
    kind: input.kind,
    correlation,
    startedAt: now,
    shellAt: null,
    dataAt: null,
    stages: new Set<RendererFlowStage>(["intent"]),
  });
  recordRendererDiagnostic({
    name: "renderer.flow.intent",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    correlation,
    fields: {
      flow_kind: diagnosticField(input.kind, "operational"),
    },
  });
}

/** Mark the shell as committed and emit `intent_to_shell_ms`. */
export function markRendererFlowShellCommitted(input: {
  kind: RendererFlowKind;
  correlationKey: string;
  detail?: RendererFlowDetail;
}): void {
  const flow = activeFlows.get(flowKey(input.kind, input.correlationKey));
  if (!flow || flow.stages.has("shell_committed")) {
    return;
  }
  const now = nowMs();
  flow.shellAt = now;
  flow.stages.add("shell_committed");
  recordRendererDiagnostic({
    name: "renderer.flow.shell_committed",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    correlation: flow.correlation,
    fields: {
      flow_kind: diagnosticField(input.kind, "operational"),
      intent_to_shell_ms: diagnosticField(round(now - flow.startedAt), "operational"),
      ...detailFields(input.detail),
    },
  });
}

/** Mark the data as ready and emit `shell_to_data_ms`. */
export function markRendererFlowDataReady(input: {
  kind: RendererFlowKind;
  correlationKey: string;
  detail?: RendererFlowDetail;
}): void {
  const flow = activeFlows.get(flowKey(input.kind, input.correlationKey));
  if (!flow || flow.stages.has("data_ready")) {
    return;
  }
  const now = nowMs();
  flow.dataAt = now;
  flow.stages.add("data_ready");
  recordRendererDiagnostic({
    name: "renderer.flow.data_ready",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    correlation: flow.correlation,
    fields: {
      flow_kind: diagnosticField(input.kind, "operational"),
      shell_to_data_ms: diagnosticField(
        round(now - (flow.shellAt ?? flow.startedAt)),
        "operational",
      ),
      intent_to_data_ms: diagnosticField(round(now - flow.startedAt), "operational"),
      ...detailFields(input.detail),
    },
  });
}

/**
 * Close the flow at content-stable and emit `renderer.flow.content_stable` with
 * every stage timing plus the flow's draft budget slot, then release its state.
 *
 * Stage timings that never happened are OMITTED (not sentinel-encoded), and
 * `stages_completed` reports how many of {shell_committed, data_ready} were
 * reached so aggregation can filter partial flows without parsing magic numbers.
 */
export function finishRendererFlow(input: {
  kind: RendererFlowKind;
  correlationKey: string;
  detail?: RendererFlowDetail;
}): void {
  const key = flowKey(input.kind, input.correlationKey);
  const flow = activeFlows.get(key);
  if (!flow) {
    return;
  }
  const now = nowMs();
  activeFlows.delete(key);
  const budget = RENDERER_FLOW_BUDGETS[input.kind];
  const stagesCompleted =
    (flow.shellAt === null ? 0 : 1) + (flow.dataAt === null ? 0 : 1);
  const fields: Record<string, RendererDiagnosticField> = {
    flow_kind: diagnosticField(input.kind, "operational"),
    stages_completed: diagnosticField(stagesCompleted, "operational"),
    data_to_stable_ms: diagnosticField(
      round(now - (flow.dataAt ?? flow.shellAt ?? flow.startedAt)),
      "operational",
    ),
    intent_to_stable_ms: diagnosticField(round(now - flow.startedAt), "operational"),
    budget_metric: diagnosticField(budget.metric, "operational"),
    budget_threshold_ms: diagnosticField(budget.thresholdMs, "operational"),
    ...detailFields(input.detail),
  };
  if (flow.shellAt !== null) {
    fields.intent_to_shell_ms = diagnosticField(
      round(flow.shellAt - flow.startedAt),
      "operational",
    );
  }
  if (flow.dataAt !== null) {
    fields.shell_to_data_ms = diagnosticField(
      round(flow.dataAt - (flow.shellAt ?? flow.startedAt)),
      "operational",
    );
  }
  recordRendererDiagnostic({
    name: "renderer.flow.content_stable",
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    correlation: flow.correlation,
    fields,
  });
}

/**
 * Drop a flow without emitting content_stable (failure / navigation away /
 * superseded selection), emitting `renderer.flow.abandoned` with an explicit
 * reason. This is the renderer-family replacement for the old
 * `cancelLatencyFlow(...)` staleness signal, so truthfulness is unchanged: an
 * abandoned flow never reports a false content_stable milestone. No-ops when the
 * flow is unknown (already finished/abandoned).
 */
export function abandonRendererFlow(input: {
  kind: RendererFlowKind;
  correlationKey: string;
  reason: string;
}): void {
  const key = flowKey(input.kind, input.correlationKey);
  const flow = activeFlows.get(key);
  if (!flow) {
    return;
  }
  activeFlows.delete(key);
  const stagesCompleted =
    (flow.shellAt === null ? 0 : 1) + (flow.dataAt === null ? 0 : 1);
  recordRendererDiagnostic({
    name: "renderer.flow.abandoned",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    correlation: flow.correlation,
    fields: {
      flow_kind: diagnosticField(input.kind, "operational"),
      reason: diagnosticField(input.reason, "operational"),
      stages_completed: diagnosticField(stagesCompleted, "operational"),
    },
  });
}

/**
 * UX-latency R14: content_stable hand-off for workspace_open.
 *
 * The workspace-open flow no longer awaits transcript hydration on its critical
 * path (that fetch moved to SessionTranscriptPane's self-hydration). So the
 * bootstrap can no longer honestly finish the flow at its own completion — the
 * transcript is not yet on screen. Instead the bootstrap DEFERS content_stable:
 * it records the target session id whose committed transcript is the real
 * "user can see it" signal, and the transcript pane finishes the flow when it
 * actually commits that session's transcript.
 *
 * The founder's rule: never emit a stable mark before the user can see the
 * transcript. A deferred flow that never commits (selection superseded before
 * the pane mounts) simply ages out via pruneStaleFlows — no false milestone.
 *
 * The registry maps a session id -> the workspace_open flow correlation key the
 * bootstrap opened for it. The bootstrap owns this mapping (it knows both the
 * correlationKey it began the flow with AND the session it selected), so the
 * pane never has to reconstruct the correlation key from workspace ids that may
 * differ from the selected/materialized id.
 */
const deferredWorkspaceOpenBySession = new Map<string, string>();

export function deferWorkspaceOpenContentStable(input: {
  sessionId: string;
  correlationKey: string;
}): void {
  // A single workspace_open flow settles on exactly one session. Drop any prior
  // deferral pointing at the same flow so a superseded session can't leak an
  // entry that never resolves.
  for (const [sessionId, correlationKey] of deferredWorkspaceOpenBySession) {
    if (correlationKey === input.correlationKey && sessionId !== input.sessionId) {
      deferredWorkspaceOpenBySession.delete(sessionId);
    }
  }
  deferredWorkspaceOpenBySession.set(input.sessionId, input.correlationKey);
}

/**
 * Finish a deferred workspace_open flow because the transcript pane committed
 * the session's transcript (the real content_stable signal). No-ops when the
 * session has no deferred workspace_open flow (a plain in-workspace session
 * switch, or an already-finished flow), so it is safe to call on every commit.
 */
export function finishDeferredWorkspaceOpenForSession(
  sessionId: string,
  detail?: RendererFlowDetail,
): void {
  const correlationKey = deferredWorkspaceOpenBySession.get(sessionId);
  if (correlationKey === undefined) {
    return;
  }
  deferredWorkspaceOpenBySession.delete(sessionId);
  finishRendererFlow({ kind: "workspace_open", correlationKey, detail });
}

export function resetRendererFlowsForTest(): void {
  activeFlows.clear();
  deferredWorkspaceOpenBySession.clear();
}
