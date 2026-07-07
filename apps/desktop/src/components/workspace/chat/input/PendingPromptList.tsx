import { useCallback } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { ArrowUpRight, Pencil, X } from "@proliferate/ui/icons";
import { GripVertical } from "lucide-react";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { useVerticalReorder } from "@/hooks/chat/ui/use-vertical-reorder";
import { usePendingPromptQueue } from "@/hooks/chat/ui/use-pending-prompt-queue";
import { CHAT_STREAMING_STATUS_LABELS } from "@/copy/chat/chat-copy";
import type { PendingPromptQueueRow } from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";

export interface PendingPromptListProps {
  entries: PendingPromptQueueRow[];
  steeringSeq: number | null;
  sessionMaterialized: boolean;
  onBeginEdit: (seq: number) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * Presentational queue list. Shows queued messages with drag-reorder,
 * steer, edit, and delete affordances.
 */
export function PendingPromptList({
  entries,
  steeringSeq,
  sessionMaterialized,
  onBeginEdit,
  onDelete,
  onSteer,
  onReorder,
}: PendingPromptListProps) {
  const { dragIndex, dropIndex, handleDragStart } = useVerticalReorder({
    itemCount: entries.length,
    onReorder,
  });

  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      className="relative flex flex-col overflow-clip rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))]"
      data-telemetry-mask
      aria-label="Queued messages"
    >
      <div
        className="vertical-scroll-fade-mask flex max-h-[30dvh] flex-col gap-px overflow-y-auto px-3 py-1.5 scrollbar-none [--edge-fade-distance:8px]"
        data-reorder-container
      >
        {entries.map((entry, index) => (
          <PendingPromptRow
            key={entry.key}
            entry={entry}
            index={index}
            totalCount={entries.length}
            sessionMaterialized={sessionMaterialized}
            isSteering={steeringSeq === entry.seq}
            isDragging={dragIndex === index}
            isDropTarget={dropIndex === index && dragIndex !== null && dragIndex !== index}
            onBeginEdit={onBeginEdit}
            onDelete={onDelete}
            onSteer={onSteer}
            onDragStart={handleDragStart}
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectedPendingPromptList() {
  const {
    rows,
    steeringSeq,
    sessionMaterialized,
    onBeginEdit,
    onDelete,
    onSteer,
    onReorder,
  } = usePendingPromptQueue();

  if (rows.length === 0) {
    return null;
  }

  return (
    <PendingPromptList
      entries={rows}
      steeringSeq={steeringSeq}
      sessionMaterialized={sessionMaterialized}
      onBeginEdit={onBeginEdit}
      onDelete={onDelete}
      onSteer={onSteer}
      onReorder={onReorder}
    />
  );
}

interface PendingPromptRowProps {
  entry: PendingPromptQueueRow;
  index: number;
  totalCount: number;
  sessionMaterialized: boolean;
  isSteering: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onBeginEdit: (seq: number) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onDragStart: (index: number, event: React.PointerEvent) => void;
}

const ROW_ACTION_CLASSNAME =
  "shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground";

function PendingPromptRow({
  entry,
  index,
  totalCount,
  sessionMaterialized,
  isSteering,
  isDragging,
  isDropTarget,
  onBeginEdit,
  onDelete,
  onSteer,
  onDragStart,
}: PendingPromptRowProps) {
  const {
    seq,
    label,
    isBeingEdited,
    isSending,
    showEditAction,
    canEdit,
    editDisabledReason,
    showDeleteAction,
    canDelete,
    deleteDisabledReason,
  } = entry;

  const isRuntimeConfirmed = seq > 0;
  const showSteerAction = isRuntimeConfirmed && sessionMaterialized && !isSending && !isBeingEdited;
  const canDragReorder = isRuntimeConfirmed && sessionMaterialized && totalCount > 1;
  const renderEditAction = showEditAction && !isBeingEdited && !isSending;
  const renderDeleteAction = showDeleteAction && (!isSending || canDelete);

  const handleBeginEdit = useCallback(() => {
    if (!canEdit) return;
    onBeginEdit(seq);
  }, [canEdit, onBeginEdit, seq]);

  const handleDelete = useCallback(() => {
    if (!canDelete) return;
    onDelete(entry);
  }, [canDelete, entry, onDelete]);

  const handleSteer = useCallback(() => {
    onSteer(entry);
  }, [entry, onSteer]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      onDragStart(index, event);
    },
    [index, onDragStart],
  );

  const stateHint = isSending || isSteering
    ? (
      <ThinkingText
        text={isSteering ? "Steering…" : CHAT_STREAMING_STATUS_LABELS.sending}
        className="shrink-0 text-ui-sm font-normal leading-[var(--text-ui-sm--line-height)]"
      />
    )
    : isBeingEdited
      ? (
        <span className="shrink-0 text-ui-sm leading-[var(--text-ui-sm--line-height)] text-faint">
          Editing…
        </span>
      )
      : null;

  return (
    <div
      data-reorder-item
      className={`group/queue-row relative flex items-center justify-between gap-2 py-0.5 pl-4 transition-colors ${
        isDragging ? "opacity-50" : ""
      } ${isDropTarget ? "border-t border-accent" : ""}`}
    >
      {/* Drag handle — left gutter, hover-reveal only */}
      {canDragReorder && (
        <div
          className="absolute left-0 flex cursor-grab items-center opacity-0 transition-opacity active:cursor-grabbing group-hover/queue-row:opacity-70"
          onPointerDown={handlePointerDown}
          aria-label="Reorder"
        >
          <GripVertical className="size-3.5 text-muted-foreground" />
        </div>
      )}

      {/* Message text — one step smaller than the chat input / transcript
          message text (--text-message, aliased to --text-composer). */}
      <div
        className={`min-w-0 flex-1 whitespace-pre-wrap text-ui leading-[var(--text-ui--line-height)] transition-colors line-clamp-2 ${
          isBeingEdited
            ? "text-muted-foreground/60"
            : "text-muted-foreground"
        }`}
        title={label}
      >
        {label}
      </div>

      {/* Trailing state hint or actions */}
      {stateHint}

      {/* Actions: hidden while sending (stateHint takes over), but delete
          stays visible alongside the "Editing..." hint. */}
      {!isSending && !isSteering && (
        <div className="flex shrink-0 items-center gap-1">
          {showSteerAction && (
            <Tooltip content="Send next — interrupts the current turn">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSteer}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Run this message next"
              >
                <ArrowUpRight className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          {renderEditAction && (
            <Tooltip content={editDisabledReason ?? "Edit message"}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canEdit}
                onClick={handleBeginEdit}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Edit queued message"
              >
                <Pencil className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          {renderDeleteAction && (
            <Tooltip content={deleteDisabledReason ?? "Remove from queue"}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canDelete}
                onClick={handleDelete}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Delete queued message"
              >
                <X className="size-3.5" />
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
