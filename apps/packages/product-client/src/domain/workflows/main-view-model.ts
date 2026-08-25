import type { WorkflowDefinitionListRowV2 } from "@proliferate/cloud-sdk";
import type { WorkflowRunV2 } from "@anyharness/sdk";

/**
 * A row as the main list renders it: just what the row shows
 * (title/description/updated-at) plus the identity a row action needs
 * (`revision` for the delete request's optimistic-concurrency check).
 *
 * The same shape carries a gen-1 row into the legacy group: everything the
 * legacy group renders and can act on (title, description, updated-at,
 * revision for delete) is present on a gen-1 list row too, so the group needs
 * no second projection — only a second predicate.
 */
export interface WorkflowMainListItem {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  revision: number;
}

function toListItem(row: WorkflowDefinitionListRowV2): WorkflowMainListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

/**
 * Narrows the shared list response down to gen-2 rows, in the order the
 * server returned them. The list route puts `schemaVersion` on the row
 * itself (see `WorkflowDefinitionListRowV2`'s doc comment in the SDK) — a
 * plain data check here keeps this domain module import-clean (Cloud SDK
 * *types* only). `isWorkflowDefinitionV2(row.definition)` is a distinct,
 * runtime-value narrowing the SDK exports for reading a row's nested v2
 * fields (nodes/edges/...); this view never touches those, so it doesn't
 * need it.
 */
export function selectWorkflowV2DefinitionRows(
  rows: readonly WorkflowDefinitionListRowV2[],
): WorkflowMainListItem[] {
  return rows.filter((row) => row.schemaVersion === 2).map(toListItem);
}

/**
 * The main page's Executions group: every run this runtime knows about,
 * newest first, ties broken by id — the same total order
 * `selectNewestWorkflowRun` (run-selection.ts) resolves a single run with, so
 * the run the pane would pick is also the run this list puts on top.
 */
export function selectWorkflowExecutionRows(
  runs: readonly WorkflowRunV2[] | undefined,
): WorkflowRunV2[] {
  return [...(runs ?? [])].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/**
 * The definition title a run was started from, read out of the run's frozen
 * `definitionJson`. The contract does not promise a title there today — this
 * is defensive against it growing one (top-level or nested under
 * `definition`), the same reading `WorkflowResumePopoverPresenter` documents —
 * so `null` means "this build has no name for it" and the caller supplies its
 * own fallback copy.
 */
export function workflowRunDefinitionTitle(definitionJson: string): string | null {
  try {
    const parsed = JSON.parse(definitionJson) as {
      title?: unknown;
      definition?: { title?: unknown };
    };
    const candidate = parsed?.title ?? parsed?.definition?.title;
    return typeof candidate === "string" && candidate.trim().length > 0
      ? candidate.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * "1m 40s" — the run's wall clock, only once it has one. A run that has not
 * completed yet has no honest elapsed figure here (the projection polls; the
 * list does not tick), so this returns `null` rather than a stale count.
 */
export function formatWorkflowRunElapsed(
  run: Pick<WorkflowRunV2, "createdAt" | "completedAt">,
): string | null {
  if (!run.completedAt) {
    return null;
  }
  const elapsedMs = Date.parse(run.completedAt) - Date.parse(run.createdAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return null;
  }
  const totalSeconds = Math.round(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * `Intl.DateTimeFormat` over the row's `updatedAt`; the current year is
 * dropped the way gen-1's list row did, so most rows read as `Aug 14` rather
 * than carrying a redundant year on every row.
 */
export function formatWorkflowUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}
