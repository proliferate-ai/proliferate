/**
 * Pure display helpers for the workflows home screen's list and drill-in run
 * rows — relative-time labels, run-status filter matching, and the run-row
 * view projection. Split out of `WorkflowsHomeScreen.tsx` (WS0B-U) so both the
 * list view and the drill-in view can share them without importing from a
 * screen file. Not a hook itself (no React behavior) — lives beside the
 * `derived` hooks that consume the same access-layer types, since
 * `lib/domain/**` may not import from `@/hooks/access/**`.
 */

import {
  coerceRunStatus,
  formatRunDuration,
  runDotKind,
  workflowRunStatusLabel,
  type WorkflowRunStatus,
} from "@proliferate/product-domain/workflows/run-status";
import { workflowTriggerLabel } from "@proliferate/product-domain/workflows/model";
import type { WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import type { WorkflowRunRowView } from "@/components/workflows/home/WorkflowListRow";

export type TargetFilter = "all" | "cloud" | "local";
export type RunStatusFilter = "all" | "running" | "success" | "failed";

export function relativeTime(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "";
  }
  const deltaSec = Math.round((Date.now() - ms) / 1000);
  if (deltaSec < 60) {
    return "just now";
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)}m ago`;
  }
  if (deltaSec < 86_400) {
    return `${Math.floor(deltaSec / 3600)}h ago`;
  }
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

export function runFilterMatches(filter: RunStatusFilter, status: WorkflowRunStatus): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return !["completed", "failed", "cancelled", "missed"].includes(status);
    case "success":
      return status === "completed";
    case "failed":
      return status === "failed" || status === "cancelled" || status === "missed";
  }
}

export function buildRunRowView(run: WorkflowRunResponse): WorkflowRunRowView {
  const status = coerceRunStatus(run.status);
  const originKind = workflowTriggerLabel(run.triggerKind);
  const ago = relativeTime(run.startedAt ?? run.createdAt);
  return {
    id: run.id,
    dotKind: runDotKind(status),
    statusLabel: workflowRunStatusLabel(status, status === "unknown" ? run.status : run.errorCode),
    originLabel: ago ? `${originKind} · ${ago}` : originKind,
    durationLabel: formatRunDuration(run.startedAt, run.finishedAt),
    target: run.targetMode === "personal_cloud" ? "cloud" : run.targetMode === "local" ? "local" : null,
  };
}
