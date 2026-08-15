import {
  diagnosticField,
  recordRendererDiagnostic,
  type RendererDiagnosticCorrelation,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

/**
 * Canonical renderer flow-timing marks (UX Latency + Transitions ADR §4.8,
 * Rung 1, Q17).
 *
 * The renderer connection/sync/turn event family (renderer-diagnostics-connection.ts,
 * renderer-diagnostic-migrations.ts) is the single instrumentation base. This
 * module extends that family with the two marks it was missing — `shell_committed`
 * and `content_stable` — so every instrumented flow yields the three stage
 * timings the ADR requires:
 *
 *   - intent_to_shell_ms  (intent      -> shell_committed): shell painted
 *   - shell_to_data_ms    (shell        -> data_ready):     data landed
 *   - data_to_stable_ms   (data_ready   -> content_stable): surface settled
 *
 * There is deliberately no fourth instrumentation layer: the older
 * `logLatency(...)` latency-flow API and the measurement-port operation API are
 * consolidated onto this event family for the four canonical flows. Marks are
 * additive — reverting this rung is deleting the mark call sites, no ordering or
 * treatment change.
 *
 * Budgets stay measurement-validated DRAFTS: each flow names a metric with a
 * threshold slot, but `thresholdMs` is null (unenforced) until treatments bind
 * to a measured budget in a later rung.
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
    },
  });
}

/** Mark the data as ready and emit `shell_to_data_ms`. */
export function markRendererFlowDataReady(input: {
  kind: RendererFlowKind;
  correlationKey: string;
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
    },
  });
}

/**
 * Close the flow at content-stable and emit `renderer.flow.content_stable` with
 * every stage timing plus the flow's draft budget slot, then release its state.
 */
export function finishRendererFlow(input: {
  kind: RendererFlowKind;
  correlationKey: string;
}): void {
  const key = flowKey(input.kind, input.correlationKey);
  const flow = activeFlows.get(key);
  if (!flow) {
    return;
  }
  const now = nowMs();
  activeFlows.delete(key);
  const budget = RENDERER_FLOW_BUDGETS[input.kind];
  recordRendererDiagnostic({
    name: "renderer.flow.content_stable",
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    correlation: flow.correlation,
    fields: {
      flow_kind: diagnosticField(input.kind, "operational"),
      intent_to_shell_ms: diagnosticField(
        flow.shellAt === null ? -1 : round(flow.shellAt - flow.startedAt),
        "operational",
      ),
      shell_to_data_ms: diagnosticField(
        flow.dataAt === null
          ? -1
          : round(flow.dataAt - (flow.shellAt ?? flow.startedAt)),
        "operational",
      ),
      data_to_stable_ms: diagnosticField(
        round(now - (flow.dataAt ?? flow.shellAt ?? flow.startedAt)),
        "operational",
      ),
      intent_to_stable_ms: diagnosticField(round(now - flow.startedAt), "operational"),
      budget_metric: diagnosticField(budget.metric, "operational"),
      budget_threshold_ms: diagnosticField(budget.thresholdMs, "operational"),
    },
  });
}

/** Drop a flow without emitting content_stable (failure / navigation away). */
export function abandonRendererFlow(input: {
  kind: RendererFlowKind;
  correlationKey: string;
}): void {
  activeFlows.delete(flowKey(input.kind, input.correlationKey));
}

export function resetRendererFlowsForTest(): void {
  activeFlows.clear();
}
