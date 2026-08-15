import type { WorkflowDefinitionListRowV2 } from "@proliferate/cloud-sdk";

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
 * The complement of `selectWorkflowV2DefinitionRows` over the same response:
 * every row the gen-2 surfaces cannot open. The shared `/v1/workflows` list
 * route returns gen-1 (`schemaVersion` 1) and gen-2 rows side by side, so
 * without this the gen-1 rows a user saved before the rebuild would be
 * dropped on the floor with nothing on screen saying so.
 *
 * Deliberately the complement rather than `schemaVersion === 1`: a row whose
 * version this build does not recognise (absent, or a future number) is
 * likewise not openable in the v2 builder, and surfacing it as legacy is
 * honest where silently discarding it is not.
 */
export function selectWorkflowLegacyDefinitionRows(
  rows: readonly WorkflowDefinitionListRowV2[],
): WorkflowMainListItem[] {
  return rows.filter((row) => row.schemaVersion !== 2).map(toListItem);
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
