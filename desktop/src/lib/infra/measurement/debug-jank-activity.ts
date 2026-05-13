import type { MeasurementOperationId } from "./debug-measurement-catalog-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";
import type {
  DebugActivityEvent,
  DebugActivityKind,
  JankIncident,
  JankIncidentCanarySnapshot,
} from "./debug-measurement-report-types";
import {
  nextDebugActivitySeq,
  nextJankIncidentSeq,
  operations,
  RECENT_DEBUG_ACTIVITY_LIMIT,
  RECENT_JANK_INCIDENT_LIMIT,
  recentDebugActivities,
  recentJankIncidents,
} from "./debug-measurement-state";
import { getTimeOrigin, now, pushBounded, round } from "./debug-measurement-utils";
import { isDebugMeasurementEnabled } from "./debug-measurement-env";

const JANK_OVERLAP_LOOKBACK_MS = 75;
const JANK_OVERLAP_LOOKAHEAD_MS = 25;
const JANK_PRECEDING_WINDOW_MS = 1_000;
const JANK_MAX_ACTIVITY_ROWS = 20;

export function recordDebugActivity(input: {
  kind: DebugActivityKind;
  label: string;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  durationMs?: number | null;
  operationIds?: readonly MeasurementOperationId[];
  metadata?: Record<string, unknown>;
}): DebugActivityEvent {
  const endedAtMs = input.endedAtMs ?? now();
  const durationMs = input.durationMs ?? (
    input.startedAtMs === undefined || input.startedAtMs === null
      ? null
      : Math.max(0, endedAtMs - input.startedAtMs)
  );
  const event: DebugActivityEvent = {
    tag: "debug_activity",
    seq: nextDebugActivitySeq(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    kind: input.kind,
    label: input.label,
    startedAtMs: input.startedAtMs === undefined ? null : round(input.startedAtMs ?? 0),
    endedAtMs: round(endedAtMs),
    durationMs: durationMs === null ? null : round(durationMs),
    operationIds: [...(input.operationIds ?? [])],
    metadata: sanitizeMetadata(input.metadata ?? {}),
  };
  pushBounded(recentDebugActivities, event, RECENT_DEBUG_ACTIVITY_LIMIT);
  return event;
}

export function recordStoreActionDebugActivity(input: {
  label: string;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}): DebugActivityEvent | null {
  if (!isDebugMeasurementEnabled()) {
    return null;
  }
  return recordDebugActivity({
    kind: "store_action",
    label: input.label,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    durationMs: input.durationMs,
    metadata: input.metadata,
  });
}

export function recordMetricDebugActivity(
  input: MeasurementMetricInput,
  operationIds: readonly MeasurementOperationId[],
): void {
  switch (input.type) {
    case "main_thread":
      if (input.metric === "render_count") {
        return;
      }
      recordDebugActivity({
        kind: input.metric === "react_commit" ? "react_commit" : input.metric,
        label: `${input.surface}.${input.metric}`,
        startedAtMs: input.startedAtMs,
        endedAtMs: input.endedAtMs,
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          surface: input.surface,
          metric: input.metric,
          count: input.count ?? null,
        },
      });
      return;
    case "workflow":
      recordDebugActivity({
        kind: "workflow",
        label: input.step,
        endedAtMs: now(),
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          count: input.count ?? null,
          outcome: input.outcome ?? null,
        },
      });
      return;
    case "diagnostic":
      recordDebugActivity({
        kind: "diagnostic",
        label: `${input.category}.${input.label}`,
        endedAtMs: now(),
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          category: input.category,
          keys: input.keys ?? [],
          detail: input.detail ?? null,
          count: input.count ?? null,
        },
      });
      return;
    case "request":
      recordDebugActivity({
        kind: "request",
        label: `${input.transport}.${input.category}.${input.method}`,
        endedAtMs: now(),
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          status: input.status,
          runtimeUrlHash: input.runtimeUrlHash ?? null,
        },
      });
      return;
    case "stream":
      recordDebugActivity({
        kind: "stream",
        label: `${input.category}.${input.phase}`,
        endedAtMs: now(),
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          eventCount: input.eventCount ?? null,
          maxInterArrivalGapMs: input.maxInterArrivalGapMs ?? null,
          malformedEventCount: input.malformedEventCount ?? null,
          runtimeUrlHash: input.runtimeUrlHash ?? null,
        },
      });
      return;
    case "store":
    case "reducer":
      recordDebugActivity({
        kind: "store",
        label: `${input.category}.${input.type}`,
        endedAtMs: now(),
        durationMs: input.durationMs,
        operationIds,
        metadata: {
          count: input.count ?? null,
        },
      });
      return;
    case "state_count":
      recordDebugActivity({
        kind: "state_count",
        label: input.target,
        operationIds,
        metadata: {
          count: input.count,
        },
      });
      return;
    case "cache":
      return;
  }
}

export function recordJankIncident(input: {
  previousFrameAtMs: number;
  frameAtMs: number;
  frameGapMs: number;
  visibleCanaries?: readonly JankIncidentCanarySnapshot[];
}): JankIncident {
  const gapStart = input.previousFrameAtMs;
  const gapEnd = input.frameAtMs;
  const activeOperationIds = [...operations.keys()];
  const activeOperationKinds = [...operations.values()].map((operation) => operation.kind);
  const overlappingActivities = recentDebugActivities
    .filter((activity) => overlapsWindow(
      activity,
      gapStart - JANK_OVERLAP_LOOKBACK_MS,
      gapEnd + JANK_OVERLAP_LOOKAHEAD_MS,
    ))
    .sort(compareActivityImpact)
    .slice(0, JANK_MAX_ACTIVITY_ROWS);
  const precedingActivities = recentDebugActivities
    .filter((activity) => {
      const endedAt = activity.endedAtMs ?? activity.startedAtMs;
      return endedAt !== null
        && endedAt >= gapStart - JANK_PRECEDING_WINDOW_MS
        && endedAt < gapStart
        && !overlappingActivities.some((overlapping) => overlapping.seq === activity.seq);
    })
    .sort((a, b) => (b.endedAtMs ?? 0) - (a.endedAtMs ?? 0))
    .slice(0, JANK_MAX_ACTIVITY_ROWS);
  const incident: JankIncident = {
    tag: "jank_incident",
    seq: nextJankIncidentSeq(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    previousFrameAtMs: round(input.previousFrameAtMs),
    frameAtMs: round(input.frameAtMs),
    frameGapMs: round(input.frameGapMs),
    activeOperationIds,
    activeOperationKinds,
    visibleCanaries: [...(input.visibleCanaries ?? [])],
    overlappingActivities,
    precedingActivities,
    likelyCauses: inferLikelyCauses(overlappingActivities, precedingActivities),
  };
  pushBounded(recentJankIncidents, incident, RECENT_JANK_INCIDENT_LIMIT);
  return incident;
}

export function clearDebugJankBuffers(): void {
  recentDebugActivities.length = 0;
  recentJankIncidents.length = 0;
}

function overlapsWindow(
  activity: DebugActivityEvent,
  startedAtMs: number,
  endedAtMs: number,
): boolean {
  const activityStart = activity.startedAtMs ?? activity.endedAtMs;
  const activityEnd = activity.endedAtMs ?? activity.startedAtMs;
  if (activityStart === null || activityEnd === null) {
    return false;
  }
  return activityStart <= endedAtMs && activityEnd >= startedAtMs;
}

function compareActivityImpact(a: DebugActivityEvent, b: DebugActivityEvent): number {
  const durationDelta = (b.durationMs ?? 0) - (a.durationMs ?? 0);
  if (durationDelta !== 0) {
    return durationDelta;
  }
  return b.seq - a.seq;
}

function inferLikelyCauses(
  overlappingActivities: readonly DebugActivityEvent[],
  precedingActivities: readonly DebugActivityEvent[],
): string[] {
  const causes = new Set<string>();
  const storeAction = [...overlappingActivities, ...precedingActivities]
    .find((activity) => activity.kind === "store_action");
  if (storeAction) {
    causes.add(`store_action:${storeAction.label}`);
  }
  const topReactCommits = overlappingActivities
    .filter((activity) => activity.kind === "react_commit")
    .slice(0, 4);
  if (topReactCommits.length > 0) {
    causes.add(`react_commit:${topReactCommits.map((activity) => activity.label).join(",")}`);
  }
  const workflow = [...overlappingActivities, ...precedingActivities]
    .find((activity) => activity.kind === "workflow");
  if (workflow) {
    causes.add(`workflow:${workflow.label}`);
  }
  const stream = overlappingActivities.find((activity) => activity.kind === "stream");
  if (stream) {
    causes.add(`stream:${stream.label}`);
  }
  const request = overlappingActivities.find((activity) => activity.kind === "request");
  if (request) {
    causes.add(`request:${request.label}`);
  }
  if (causes.size === 0) {
    causes.add("unattributed:layout-paint-gc-or-native");
  }
  return [...causes];
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      sanitized[key] = `${value.slice(0, 500)}...`;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
