import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";

/**
 * Where keyboard focus belongs after a viewer target is activated.
 *
 * `"viewer"` (the default for external origins such as chat, transcript, the
 * command palette, and Changes) hands focus to the mounted viewer frame.
 * `"preserve-origin"` keeps the caller's own control — a file-tree row, a
 * workspace header tab, or a right-panel header entry — as the focus target
 * while only the selection changes.
 */
export type ViewerActivationFocus = "viewer" | "preserve-origin";

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  reuseMeasurementOperation?: boolean;
  allowColdIdleNoStream?: boolean;
  forceCold?: boolean;
}
