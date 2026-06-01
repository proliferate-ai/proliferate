import type { MeasurementMemorySnapshot } from "./debug-measurement-report-types";

export const BOOT_DIAGNOSTICS_PARAM = "proliferateBootDiagnostics";
export const BOOT_DIAGNOSTICS_STORAGE_KEY = "proliferate.bootDiagnostics";
export const BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY = "proliferate.bootDiagnostics.events";
export const BOOT_DIAGNOSTICS_OVERLAY_ID = "proliferate-boot-diagnostics";
export const MAX_BOOT_EVENTS = 160;
export const MAX_VISIBLE_EVENTS = 18;
export const MAX_FETCH_SUMMARY_ENTRIES = 240;
export const MAX_LAYOUT_READ_STACK_SUMMARIES = 80;
export const MAX_PERFORMANCE_MEASURE_SUMMARIES = 80;
export const MAX_PERFORMANCE_MEASURE_REPORTS = 30;
export const FRAME_GAP_THRESHOLD_MS = 200;
export const MAX_LAYOUT_READ_REPORTS = 40;
export const MAX_LAYOUT_READ_STACK_CAPTURE_COUNT = 80;
export const SLOW_LAYOUT_READ_THRESHOLD_MS = 12;
export const LAYOUT_READ_TOTAL_MILESTONES = new Set([1, 5, 10, 25, 50, 100, 250, 500, 1_000]);
export const INTERNAL_LOG_RENDERER_EVENT_URL = "ipc://localhost/log_renderer_event";
export const NOISY_BOOT_LABEL_PREFIXES = ["app_runtime.render.", "fetch.", "performance.measure."];

export interface BootDiagnosticEvent {
  seq: number;
  elapsedMs: number;
  timestampMs: number;
  label: string;
  route: string | null;
  metadata?: Record<string, unknown>;
}

export interface BootDiagnosticDump {
  tag: "boot_stall_diagnostics";
  version: 3;
  createdAt: string;
  timestampMs: number;
  route: string | null;
  eventSeq: number;
  droppedEvents: number;
  maxFrameGapMs: number;
  memory: MeasurementMemorySnapshot;
  fetches: {
    starts: number;
    ends: number;
    errors: number;
    inFlight: number;
    top: FetchDiagnosticSummary[];
  };
  performanceMeasures: {
    calls: number;
    detailStripped: number;
    top: PerformanceMeasureDiagnosticSummary[];
  };
  layoutReads: {
    inAnimationFrames: number;
    reported: number;
    uniqueStacks: number;
    topStacks: LayoutReadStackDiagnosticSummary[];
  };
  events: BootDiagnosticEvent[];
}

export interface FetchDiagnosticSummary {
  key: string;
  method: string;
  url: string;
  starts: number;
  ends: number;
  errors: number;
  inFlight: number;
  lastStatus: number | null;
  lastDurationMs: number | null;
  maxDurationMs: number;
  lastError: unknown;
}

export interface LayoutReadStackDiagnosticSummary {
  signature: string;
  count: number;
  reported: number;
  slow: number;
  lastDurationMs: number;
  maxDurationMs: number;
  lastElement: string | null;
  lastStack: string | null;
}

export interface PerformanceMeasureDiagnosticSummary {
  name: string;
  calls: number;
  detailStripped: number;
  nativeSkipped: number;
  lastDetailSummary: unknown;
  lastStack: string | null;
}

export interface ActiveAnimationFrameDiagnostic {
  callbackName: string;
  id: number;
  scheduledAtMs: number;
  startedAtMs: number;
}

export interface BootDiagnosticOverlay {
  root: HTMLElement;
  summary: HTMLElement;
  events: HTMLElement;
}

export interface BootDiagnosticApi {
  dump: () => BootDiagnosticDump;
  clear: () => void;
}

export type BootDiagnosticRecorder = (
  label: string,
  metadata?: Record<string, unknown>,
) => void;
