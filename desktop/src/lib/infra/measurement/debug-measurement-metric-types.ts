import type {
  MeasurementOperationId,
  MeasurementStateCountTarget,
  MeasurementSurface,
  MeasurementTimingCategory,
  MeasurementWorkflowOutcome,
  MeasurementWorkflowStep,
} from "./debug-measurement-catalog-types";

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
      category: MeasurementTimingCategory;
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
      category: MeasurementTimingCategory;
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
