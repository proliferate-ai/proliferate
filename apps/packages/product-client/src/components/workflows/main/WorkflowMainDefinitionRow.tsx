import type { WorkflowMainListItem } from "#product/domain/workflows/main-view-model";
import { formatWorkflowUpdatedAt } from "#product/domain/workflows/main-view-model";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#product/primitives/DropdownMenu";
import { MoreHorizontal, Pencil, Play, Trash } from "#product/primitives/icons/core";
import { Workflow } from "#product/primitives/icons/product";
import { IconTile } from "#product/primitives/IconTile";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";

export function WorkflowMainDefinitionRow({
  item,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  item: WorkflowMainListItem;
  /** The Run fetch for this row's full record is in flight. */
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <RosterRow
      density="comfortable"
      leading={(
        <IconTile tone="elevated">
          <Workflow className="icon-paired" aria-hidden />
        </IconTile>
      )}
      title={item.title}
      secondary={item.description ? <span className="line-clamp-2">{item.description}</span> : undefined}
      trailing={formatWorkflowUpdatedAt(item.updatedAt)}
      onSelect={onEdit}
      actions={(
        <>
          <RowActionIconButton
            label={WORKFLOW_MAIN_COPY.runLabel(item.title)}
            disabled={running}
            onClick={onRun}
          >
            <Play />
          </RowActionIconButton>
          <RowActionIconButton
            label={WORKFLOW_MAIN_COPY.editLabel(item.title)}
            onClick={onEdit}
          >
            <Pencil />
          </RowActionIconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <RowActionIconButton label={WORKFLOW_MAIN_COPY.rowActionsLabel(item.title)}>
                <MoreHorizontal />
              </RowActionIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash className="icon-paired" />
                {WORKFLOW_MAIN_COPY.deleteItemLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    />
  );
}
