import type {
  MeasurementCategoryBinding,
  MeasurementOperationFinishListener,
  MeasurementOperationRecord,
} from "./debug-measurement-registry-types";
import type {
  MeasurementOperationId,
  MeasurementSurface,
} from "./debug-measurement-catalog-types";
import type {
  DebugActivityEvent,
  JankIncident,
  MeasurementMemoryEvent,
  MeasurementMetricEvent,
  MeasurementOperationEvent,
  MeasurementSummaryPayload,
} from "./debug-measurement-report-types";

export const RECENT_METRIC_LIMIT = 50_000;
export const RECENT_OPERATION_EVENT_LIMIT = 1_000;
export const RECENT_MEMORY_SAMPLE_LIMIT = 1_000;
export const RECENT_DEBUG_ACTIVITY_LIMIT = 5_000;
export const RECENT_JANK_INCIDENT_LIMIT = 500;
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

export const operations = new Map<MeasurementOperationId, MeasurementOperationRecord>();
export const activeSampleOperations = new Map<string, MeasurementOperationId>();
export const cooldownUntilBySample = new Map<string, number>();
export const pendingCommitMarks = new Map<MeasurementOperationId, Set<MeasurementSurface>>();
export const categoryBindings = new Map<string, MeasurementCategoryBinding>();
export const operationFinishListeners = new Map<
  MeasurementOperationId,
  Set<MeasurementOperationFinishListener>
>();
export const recentMetrics: MeasurementMetricEvent[] = [];
export const recentDebugActivities: DebugActivityEvent[] = [];
export const recentJankIncidents: JankIncident[] = [];
export const recentOperationEvents: MeasurementOperationEvent[] = [];
export const recentMemorySamples: MeasurementMemoryEvent[] = [];
export const recentSummaries: MeasurementSummaryPayload[] = [];

let operationSeq = 0;
let bindingSeq = 0;
let metricEventSeq = 0;
let debugActivitySeq = 0;
let jankIncidentSeq = 0;
let operationEventSeq = 0;
let memoryEventSeq = 0;

export function nextMeasurementOperationId(): MeasurementOperationId {
  return `mop_${(++operationSeq).toString(36)}` as MeasurementOperationId;
}

export function nextMeasurementBindingId(): string {
  return `binding_${++bindingSeq}`;
}

export function nextMeasurementMetricEventSeq(): number {
  return ++metricEventSeq;
}

export function nextDebugActivitySeq(): number {
  return ++debugActivitySeq;
}

export function nextJankIncidentSeq(): number {
  return ++jankIncidentSeq;
}

export function nextMeasurementOperationEventSeq(): number {
  return ++operationEventSeq;
}

export function nextMeasurementMemoryEventSeq(): number {
  return ++memoryEventSeq;
}

export function resetMeasurementSequencesForTest(): void {
  operationSeq = 0;
  bindingSeq = 0;
  metricEventSeq = 0;
  debugActivitySeq = 0;
  jankIncidentSeq = 0;
  operationEventSeq = 0;
  memoryEventSeq = 0;
}
