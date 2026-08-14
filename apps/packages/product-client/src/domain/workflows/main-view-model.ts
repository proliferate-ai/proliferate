import type { WorkflowDefinitionListRowV2 } from "@proliferate/cloud-sdk";

/**
 * A gen-2 row as the main list renders it: just what the row shows
 * (title/description/updated-at) plus the identity a row action needs
 * (`revision` for the delete request's optimistic-concurrency check).
 *
 * The shared `/v1/workflows` list route returns gen-1 and gen-2 rows side by
 * side (`WorkflowDefinitionListRowV2.definition` is typed `unknown` for
 * exactly that reason); this view stays gen-2-only, so callers never carry a
 * gen-1 row past this boundary.
 */
export interface WorkflowMainListItem {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  revision: number;
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
  return rows
    .filter((row) => row.schemaVersion === 2)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      updatedAt: row.updatedAt,
      revision: row.revision,
    }));
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
