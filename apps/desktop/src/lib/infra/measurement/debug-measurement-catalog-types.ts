import type { AnyHarnessMeasurementOperationId } from "@anyharness/sdk";

export type MeasurementOperationId = AnyHarnessMeasurementOperationId;

export type MeasurementOperationKind = string;

export type MeasurementSurface = string;

export type MeasurementSampleKey = string;

export type MeasurementFinishReason =
  | "completed"
  | "idle"
  | "max_duration"
  | "unmount"
  | "navigation"
  | "aborted"
  | "disabled"
  | "error_sanitized";

export type MeasurementTimingCategory = string;

export type MeasurementWorkflowStep = string;

export type MeasurementStateCountTarget = string;

export type MeasurementWorkflowOutcome =
  | "completed"
  | "skipped"
  | "cache_hit"
  | "cache_miss"
  | "error_sanitized";
