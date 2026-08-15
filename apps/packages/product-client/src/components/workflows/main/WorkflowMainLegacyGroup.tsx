import type { WorkflowMainListItem } from "#product/domain/workflows/main-view-model";
import { formatWorkflowUpdatedAt } from "#product/domain/workflows/main-view-model";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { Badge } from "#product/primitives/Badge";
import { Trash } from "#product/primitives/icons/core";
import { Workflow } from "#product/primitives/icons/product";
import { IconTile } from "#product/primitives/IconTile";
import { Card } from "#product/primitives/patterns/Card";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";

/**
 * The gen-1 definitions a user saved before the rebuild, surfaced instead of
 * dropped. Delete-only by construction: a v1 definition has no gen-2
 * nodes/edges document, so it cannot open in the v2 builder or be placed as a
 * v2 invocation, and offering Edit or Run would be offering a dead end. So the
 * row passes no `onSelect` (read-only, not a button) and carries exactly one
 * action.
 *
 * Delete reuses the caller's existing definition-delete mutation unchanged:
 * `DELETE /v1/workflows/{id}?expectedRevision=` is the shared route for both
 * schema versions, so no legacy-specific server surface exists or is needed.
 *
 * The action stays visible at rest rather than revealing on row hover — the
 * reveal contract reads as "this row has more to it", and on a row whose whole
 * point is that nothing else is available, that would mislead.
 */
export function WorkflowMainLegacyGroup({
  items,
  onDelete,
}: {
  items: readonly WorkflowMainListItem[];
  onDelete: (item: WorkflowMainListItem) => void;
}) {
  return (
    <Card
      surface="opaque"
      as="section"
      className="flex flex-col gap-0.5 p-2"
      header={(
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <h2 className="text-ui font-medium text-foreground">
            {WORKFLOW_MAIN_COPY.legacyGroupTitle}
          </h2>
          <p className="text-ui-sm text-muted-foreground">
            {WORKFLOW_MAIN_COPY.legacyGroupDescription}
          </p>
        </div>
      )}
    >
      {items.map((item) => (
        <RosterRow
          key={item.id}
          density="comfortable"
          leading={(
            <IconTile tone="elevated">
              <Workflow className="icon-paired" aria-hidden />
            </IconTile>
          )}
          title={item.title}
          secondary={(
            <span className="flex min-w-0 items-center gap-2">
              <Badge tone="neutral" size="micro">
                {WORKFLOW_MAIN_COPY.legacyBadgeLabel}
              </Badge>
              {item.description ? <span className="truncate">{item.description}</span> : null}
            </span>
          )}
          trailing={formatWorkflowUpdatedAt(item.updatedAt)}
          actions={(
            <RowActionIconButton
              label={WORKFLOW_MAIN_COPY.legacyDeleteLabel(item.title)}
              visibility="always"
              onClick={() => onDelete(item)}
            >
              <Trash />
            </RowActionIconButton>
          )}
        />
      ))}
    </Card>
  );
}
