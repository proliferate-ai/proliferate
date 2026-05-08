import type {
  AnyHarnessMeasurementOperationId,
  AnyHarnessTimingCategory,
} from "@anyharness/sdk";

export type MeasurementOperationId = AnyHarnessMeasurementOperationId;

export type MeasurementOperationKind =
  | "workspace_open"
  | "workspace_collections_refresh"
  | "workspace_hot_reopen"
  | "session_switch"
  | "session_hot_switch"
  | "session_history_initial_hydrate"
  | "session_history_tail_reconcile"
  | "session_history_older_chunk"
  | "session_stream_sample"
  | "session_stream_event_batch"
  | "prompt_submit"
  | "composer_typing"
  | "workspace_background_reconcile"
  | "transcript_scroll"
  | "file_tree_expand"
  | "file_tree_scroll"
  | "session_rename"
  | "workspace_rename"
  | "hover_sample"
  | "diff_review_sample";

export type MeasurementSurface =
  | "workspace-shell"
  | "workspace-sidebar"
  | "global-header"
  | "header-tabs"
  | "chat-surface"
  | "chat-composer"
  | "chat-composer-dock"
  | "session-transcript-pane"
  | "transcript-list"
  | "file-tree"
  | "loading-braille"
  | "send-button"
  | "stop-button"
  | "header-tab"
  | "sidebar-workspace-row"
  | "all-changes-frame"
  | "diff-viewer";

export type MeasurementSampleKey =
  | "composer"
  | "transcript"
  | "file_tree"
  | "stream"
  | "send_button"
  | "stop_button"
  | "header_tab"
  | "sidebar_workspace_row"
  | "diff_review";

export type MeasurementFinishReason =
  | "completed"
  | "idle"
  | "max_duration"
  | "unmount"
  | "navigation"
  | "aborted"
  | "disabled"
  | "error_sanitized";

export type MeasurementCloudCategory =
  | "cloud.workspace.list"
  | "cloud.workspace.display_name.update";

export type MeasurementTimingCategory =
  | AnyHarnessTimingCategory
  | MeasurementCloudCategory;

export type MeasurementWorkflowStep =
  | "workspace.hot_reopen.activate"
  | "workspace.hot_reopen.after_paint"
  | "workspace.hot_reopen.reconcile"
  | "workspace.collections.fetch"
  | "workspace.collections.build"
  | "workspace.bootstrap.sessions"
  | "workspace.bootstrap.file_tree_init"
  | "workspace.bootstrap.dismissed_sessions"
  | "workspace.bootstrap.launch_catalog"
  | "workspace.bootstrap.initial_session"
  | "workspace.bootstrap.session_select"
  | "workspace.shell.pending_activation"
  | "workspace.shell.after_paint"
  | "workspace.shell.durable_intent"
  | "workspace.shell.real_activation"
  | "workspace.shell.pending_clear"
  | "workspace.shell.pending_rollback"
  | "session.select.hot_slot_activate"
  | "session.select.ensure_sessions"
  | "session.select.slot_store"
  | "session.select.history_hydrate"
  | "session.select.stream_connect"
  | "session.select.stream_connect_scheduled"
  | "session.history.fetch"
  | "session.history.replay"
  | "session.history.store"
  | "session.history.mount_subagents"
  | "session.history.resolve_target"
  | "session.summary.resolve_target"
  | "session.stream.initial_history_hydrate"
  | "session.stream.initial_refresh"
  | "session.stream.skip_cold_idle"
  | "session.stream.open_handle"
  | "session.stream.open"
  | "session.stream.resolve_target"
  | "session.resume.resolve_target"
  | "session.resume.workspace_get"
  | "session.resume.resolve_mcp"
  | "prompt.submit.blocks_prepare"
  | "prompt.submit.enqueue"
  | "prompt.submit.after_paint";

export type MeasurementStateCountTarget =
  | "session.history.events_fetched"
  | "session.history.events_before"
  | "session.history.events_after"
  | "session.history.turns_before"
  | "session.history.turns_after"
  | "session.history.items_before"
  | "session.history.items_after"
  | "session.stream.events_before"
  | "session.stream.events_after"
  | "session.stream.turns_before"
  | "session.stream.turns_after"
  | "session.stream.items_before"
  | "session.stream.items_after";

export type MeasurementWorkflowOutcome =
  | "completed"
  | "skipped"
  | "cache_hit"
  | "cache_miss"
  | "error_sanitized";

export type MeasurementMetricInput =
  | {
      type: "request";
      transport: "anyharness" | "cloud";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      runtimeUrlHash?: string;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      status: number | "network_error" | "aborted";
      durationMs: number;
    }
  | {
      type: "stream";
      category: "session.stream";
      operationId?: MeasurementOperationId;
      runtimeUrlHash?: string;
      phase:
        | "connect"
        | "first_event"
        | "event"
        | "close"
        | "abort"
        | "network_error";
      durationMs?: number;
      eventCount?: number;
      maxInterArrivalGapMs?: number;
      malformedEventCount?: number;
    }
  | {
      type: "cache";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      decision: "hit" | "miss" | "stale" | "skipped";
      source: "react_query" | "workflow";
    }
  | {
      type: "reducer";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
    }
  | {
      type: "store";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
    }
  | {
      type: "workflow";
      step: MeasurementWorkflowStep;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
      outcome?: MeasurementWorkflowOutcome;
    }
  | {
      type: "state_count";
      target: MeasurementStateCountTarget;
      operationId?: MeasurementOperationId;
      count: number;
    }
  | {
      type: "main_thread";
      surface: MeasurementSurface;
      operationId?: MeasurementOperationId;
      metric: "react_commit" | "render_count" | "long_task" | "frame_gap";
      durationMs?: number;
      count?: number;
    }
  | {
      type: "diagnostic";
      category: string;
      label: string;
      operationId?: MeasurementOperationId;
      durationMs?: number;
      count?: number;
      keys?: readonly string[];
      detail?: string | null;
    };

export type MeasurementSummaryValue = string | number | boolean | null;
export type MeasurementSummaryRow = Record<string, MeasurementSummaryValue>;

export interface MeasurementSummaryPayload {
  tag: "measurement_summary_json";
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  finishReason: MeasurementFinishReason;
  durationMs: number;
  rows: MeasurementSummaryRow[];
}
export interface MeasurementMetricEvent {
  tag: "measurement_metric";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  operationIds: MeasurementOperationId[];
  metric: MeasurementMetricSnapshot;
}

export interface MeasurementOperationEvent {
  tag: "measurement_operation";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  phase: "start" | "finish";
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  finishReason?: MeasurementFinishReason;
  durationMs?: number;
  surfaces: MeasurementSurface[];
  sampleKey: MeasurementSampleKey | null;
}

export type MeasurementMetricSnapshot =
  | {
      type: "request";
      transport: "anyharness" | "cloud";
      category: MeasurementTimingCategory;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      status: number | "network_error" | "aborted";
      durationMs: number;
      runtimeUrlHash: string | null;
    }
  | {
      type: "stream";
      phase: Extract<MeasurementMetricInput, { type: "stream" }>["phase"];
      durationMs: number | null;
      eventCount: number | null;
      maxInterArrivalGapMs: number | null;
      malformedEventCount: number | null;
      runtimeUrlHash: string | null;
    }
  | {
      type: "cache";
      category: MeasurementTimingCategory;
      decision: "hit" | "miss" | "stale" | "skipped";
      source: "react_query" | "workflow";
    }
  | {
      type: "reducer" | "store";
      category: MeasurementTimingCategory;
      durationMs: number;
      count: number | null;
    }
  | {
      type: "workflow";
      step: MeasurementWorkflowStep;
      durationMs: number;
      count: number | null;
      outcome: MeasurementWorkflowOutcome | null;
    }
  | {
      type: "state_count";
      target: MeasurementStateCountTarget;
      count: number;
    }
  | {
      type: "main_thread";
      surface: MeasurementSurface;
      metric: "react_commit" | "render_count" | "long_task" | "frame_gap";
      durationMs: number | null;
      count: number | null;
    }
  | {
      type: "diagnostic";
      category: string;
      label: string;
      durationMs: number | null;
      count: number | null;
      keys: string[];
      detail: string | null;
    };

export interface MeasurementOperationSnapshot {
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  durationMs: number;
  surfaces: MeasurementSurface[];
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  hasMetrics: boolean;
  aggregate: MeasurementAggregateSnapshot;
}

export interface MeasurementAggregateSnapshot {
  requestCount: number;
  totalRequestMs: number;
  maxRequestMs: number;
  streamEventCount: number;
  streamFirstEventMs: number | null;
  maxStreamEventGapMs: number;
  malformedStreamEventCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheStaleCount: number;
  cacheSkippedCount: number;
  reducerApplyCount: number;
  totalReducerApplyMs: number;
  maxReducerApplyMs: number;
  storeApplyCount: number;
  totalStoreApplyMs: number;
  maxStoreApplyMs: number;
  reactCommitCount: number;
  firstCommitMs: number | null;
  totalCommitMs: number;
  maxCommitMs: number;
  renderCount: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
  diagnosticCount: number;
  totalDiagnosticMs: number;
  maxDiagnosticMs: number;
}

export interface MeasurementMemorySnapshot {
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
}

export interface MeasurementMemoryEvent extends MeasurementMemorySnapshot {
  tag: "measurement_memory";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  activeOperations: number;
  recentMetrics: number;
  recentSummaries: number;
}

export interface MeasurementDebugDump {
  tag: "measurement_dump";
  version: 1;
  createdAt: string;
  timestampMs: number;
  timeOriginMs: number | null;
  enabled: {
    mainThread: boolean;
    anyHarnessTiming: boolean;
  };
  longTaskObserverSupported: boolean;
  memory: MeasurementMemorySnapshot;
  counts: {
    activeOperations: number;
    pendingCommitMarks: number;
    categoryBindings: number;
    recentOperationEvents: number;
    recentMetrics: number;
    recentMemorySamples: number;
    recentSummaries: number;
  };
  activeOperations: MeasurementOperationSnapshot[];
  recentOperationEvents: MeasurementOperationEvent[];
  recentMetrics: MeasurementMetricEvent[];
  recentMemorySamples: MeasurementMemoryEvent[];
  recentSummaries: MeasurementSummaryPayload[];
}

export interface MeasurementDebugStatus {
  enabled: MeasurementDebugDump["enabled"];
  counts: MeasurementDebugDump["counts"];
}

export interface MeasurementDebugApi {
  dump: () => MeasurementDebugDump;
  export: (fileName?: string) => MeasurementDebugDump;
  clear: () => void;
  status: () => MeasurementDebugStatus;
}

declare global {
  interface Window {
    proliferateDebugMeasurement?: MeasurementDebugApi;
    __PROLIFERATE_DEBUG_MEASUREMENT__?: MeasurementDebugApi;
  }
}

export interface DurationAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface MeasurementRequestBreakdown extends DurationAggregate {
  transport: "anyharness" | "cloud";
  category: MeasurementTimingCategory;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  status: number | "network_error" | "aborted";
}

export interface MeasurementStreamBreakdown extends DurationAggregate {
  phase: Extract<MeasurementMetricInput, { type: "stream" }>["phase"];
  eventCount: number;
  maxInterArrivalGapMs: number;
  malformedEventCount: number;
}

export interface MeasurementCacheBreakdown {
  category: MeasurementTimingCategory;
  hitCount: number;
  missCount: number;
  staleCount: number;
  skippedCount: number;
}

export interface MeasurementWorkflowBreakdown extends DurationAggregate {
  step: MeasurementWorkflowStep;
  completedCount: number;
  skippedCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  errorSanitizedCount: number;
}

export interface MeasurementSurfaceBreakdown {
  surface: MeasurementSurface;
  reactCommitCount: number;
  totalCommitMs: number;
  maxCommitMs: number;
  renderCount: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
}

export interface MeasurementStateCountBreakdown {
  target: MeasurementStateCountTarget;
  samples: number;
  latestCount: number;
  maxCount: number;
}

export interface MeasurementDiagnosticBreakdown extends DurationAggregate {
  category: string;
  label: string;
  latestKeys: string;
  latestDetail: string | null;
}

export interface MeasurementCategoryBindingInput {
  operationId: MeasurementOperationId;
  categories: readonly MeasurementTimingCategory[];
  scope: {
    runtimeUrlHash?: string;
    workspaceScope?: "selected" | "target";
    sampleKey?: MeasurementSampleKey;
  };
  ttlMs: number;
}

export interface MeasurementOperationAggregate {
  requestCount: number;
  totalRequestMs: number;
  maxRequestMs: number;
  streamEventCount: number;
  streamFirstEventMs: number | null;
  maxStreamEventGapMs: number;
  malformedStreamEventCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheStaleCount: number;
  cacheSkippedCount: number;
  reducerApplyCount: number;
  totalReducerApplyMs: number;
  maxReducerApplyMs: number;
  storeApplyCount: number;
  totalStoreApplyMs: number;
  maxStoreApplyMs: number;
  reactCommitCount: number;
  firstCommitAtMs: number | null;
  totalCommitMs: number;
  maxCommitMs: number;
  renderCount: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
  diagnosticCount: number;
  totalDiagnosticMs: number;
  maxDiagnosticMs: number;
  requestBreakdowns: Map<string, MeasurementRequestBreakdown>;
  streamBreakdowns: Map<string, MeasurementStreamBreakdown>;
  cacheBreakdowns: Map<string, MeasurementCacheBreakdown>;
  reducerBreakdowns: Map<string, DurationAggregate>;
  storeBreakdowns: Map<string, DurationAggregate>;
  workflowBreakdowns: Map<string, MeasurementWorkflowBreakdown>;
  stateCountBreakdowns: Map<MeasurementStateCountTarget, MeasurementStateCountBreakdown>;
  surfaceBreakdowns: Map<MeasurementSurface, MeasurementSurfaceBreakdown>;
  diagnosticBreakdowns: Map<string, MeasurementDiagnosticBreakdown>;
}

export interface MeasurementOperationRecord {
  id: MeasurementOperationId;
  kind: MeasurementOperationKind;
  surfaces: Set<MeasurementSurface>;
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  startedAt: number;
  idleTimeoutMs: number | null;
  maxDurationMs: number | null;
  cooldownMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  inFlightRequestCount: number;
  hasMetrics: boolean;
  aggregate: MeasurementOperationAggregate;
}

export type MeasurementOperationFinishListener = (input: {
  operationId: MeasurementOperationId;
  reason: MeasurementFinishReason;
}) => void;

export interface MeasurementCategoryBinding {
  id: string;
  operationId: MeasurementOperationId;
  categories: Set<MeasurementTimingCategory>;
  runtimeUrlHash: string | null;
  workspaceScope: "selected" | "target" | null;
  sampleKey: MeasurementSampleKey | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
