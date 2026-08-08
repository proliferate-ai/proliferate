import { useCallback, useMemo } from "react";
import { Button } from "#product/primitives/Button";
import { Tooltip } from "#product/primitives/Tooltip";
import { ArrowUpRight, GripVertical, Pencil, X } from "#product/primitives/icons/core";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { CHAT_STREAMING_STATUS_LABELS } from "#product/copy/chat/chat-copy";
import { usePendingPromptQueue } from "#product/hooks/chat/ui/use-pending-prompt-queue";
import { useSubagentComposerStrip } from "#product/hooks/chat/facade/subagents/use-subagent-composer-strip";
import { useVerticalReorder } from "#product/hooks/chat/ui/use-vertical-reorder";
import type { PendingPromptQueueRow } from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { groupPendingAgentUpdates } from "#product/domain/chats/pending-prompts/pending-agent-updates";
import { PendingAgentUpdatesRow } from "#product/components/workspace/chat/input/PendingAgentUpdatesRow";

export interface PendingPromptListProps {
  entries: PendingPromptQueueRow[];
  steeringSeq: number | null;
  sessionMaterialized: boolean;
  queueMutationInFlight: boolean;
  onBeginEdit: (entry: PendingPromptQueueRow) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Resolves a delegation link to the session behind it, for wake pointers. */
  sessionIdByLinkId?: Readonly<Record<string, string>>;
  onOpenAgent?: (sessionId: string) => void;
}

/**
 * Presentational queued-message list with reorder, steer, edit, and remove.
 *
 * The human's own queued messages get the full row. Anything an agent queued
 * collapses into ONE quiet row underneath them (ADR §4): you see that updates
 * are pending, not what they say.
 */
export function PendingPromptList({
  entries,
  steeringSeq,
  sessionMaterialized,
  queueMutationInFlight,
  onBeginEdit,
  onDelete,
  onSteer,
  onReorder,
  sessionIdByLinkId,
  onOpenAgent,
}: PendingPromptListProps) {
  const humanEntries = entries.filter((entry) => !entry.agentSource);
  const agentUpdates = groupPendingAgentUpdates({ rows: entries, sessionIdByLinkId });
  const { dragIndex, dropIndex, handleDragStart } = useVerticalReorder({
    itemCount: humanEntries.length,
    onReorder,
  });

  if (entries.length === 0) {
    return null;
  }

  const runtimeEntryIndexes = humanEntries.flatMap((entry, index) => entry.seq > 0 ? [index] : []);

  return (
    <div
      className="relative flex flex-col overflow-clip rounded-t-xl border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))]"
      data-telemetry-mask
      aria-label="Queued messages"
    >
      <div
        className="vertical-scroll-fade-mask flex max-h-[30dvh] flex-col gap-px overflow-y-auto px-3 py-1.5 scrollbar-none [--edge-fade-distance:8px]"
        data-reorder-container
      >
        {humanEntries.map((entry, index) => {
          const runtimeIndex = runtimeEntryIndexes.indexOf(index);
          return (
            <PendingPromptRow
              key={entry.key}
              entry={entry}
              index={index}
              previousReorderIndex={runtimeIndex > 0
                ? runtimeEntryIndexes[runtimeIndex - 1] ?? null
                : null}
              nextReorderIndex={runtimeIndex >= 0
                ? runtimeEntryIndexes[runtimeIndex + 1] ?? null
                : null}
              runtimeEntryCount={runtimeEntryIndexes.length}
              sessionMaterialized={sessionMaterialized}
              isSteering={steeringSeq === entry.seq}
              isDragging={dragIndex === index}
              isDropTarget={dropIndex === index && dragIndex !== null && dragIndex !== index}
              queueMutationInFlight={queueMutationInFlight}
              onBeginEdit={onBeginEdit}
              onDelete={onDelete}
              onSteer={onSteer}
              onDragStart={handleDragStart}
              onReorder={onReorder}
            />
          );
        })}
        {agentUpdates && (
          <PendingAgentUpdatesRow updates={agentUpdates} onOpenAgent={onOpenAgent} />
        )}
      </div>
    </div>
  );
}

export function ConnectedPendingPromptList() {
  const queue = usePendingPromptQueue();
  // A link-scoped wake pointer names a link, not a session. The composer
  // already holds this session's delegation links, so it can resolve one to the
  // agent a glyph click should open.
  const subagents = useSubagentComposerStrip();
  const sessionIdByLinkId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of [...(subagents?.rows ?? []), ...(subagents?.ownedAgents ?? [])]) {
      map[row.sessionLinkId] = row.childSessionId;
    }
    return map;
  }, [subagents]);

  if (queue.rows.length === 0) {
    return null;
  }

  return (
    <PendingPromptList
      sessionIdByLinkId={sessionIdByLinkId}
      onOpenAgent={subagents?.openSubagent}
      entries={queue.rows}
      steeringSeq={queue.steeringSeq}
      sessionMaterialized={queue.sessionMaterialized}
      queueMutationInFlight={queue.queueMutationInFlight}
      onBeginEdit={queue.onBeginEdit}
      onDelete={queue.onDelete}
      onSteer={queue.onSteer}
      onReorder={queue.onReorder}
    />
  );
}

interface PendingPromptRowProps {
  entry: PendingPromptQueueRow;
  index: number;
  previousReorderIndex: number | null;
  nextReorderIndex: number | null;
  runtimeEntryCount: number;
  sessionMaterialized: boolean;
  isSteering: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  queueMutationInFlight: boolean;
  onBeginEdit: (entry: PendingPromptQueueRow) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onDragStart: (index: number, event: React.PointerEvent) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const ROW_ACTION_CLASSNAME =
  "shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground";

function PendingPromptRow({
  entry,
  index,
  previousReorderIndex,
  nextReorderIndex,
  runtimeEntryCount,
  sessionMaterialized,
  isSteering,
  isDragging,
  isDropTarget,
  queueMutationInFlight,
  onBeginEdit,
  onDelete,
  onSteer,
  onDragStart,
  onReorder,
}: PendingPromptRowProps) {
  const isRuntimeConfirmed = entry.seq > 0;
  const showSteerAction =
    isRuntimeConfirmed
    && sessionMaterialized
    && !entry.isSending
    && !entry.isBeingEdited;
  const canDragReorder =
    isRuntimeConfirmed
    && sessionMaterialized
    && runtimeEntryCount > 1
    && !queueMutationInFlight;
  const renderEditAction = entry.showEditAction && !entry.isBeingEdited && !entry.isSending;
  const renderDeleteAction = entry.showDeleteAction && (!entry.isSending || entry.canDelete);

  const handleBeginEdit = useCallback(() => {
    if (entry.canEdit) {
      onBeginEdit(entry);
    }
  }, [entry, onBeginEdit]);
  const handleDelete = useCallback(() => {
    if (entry.canDelete) {
      onDelete(entry);
    }
  }, [entry, onDelete]);
  const handleSteer = useCallback(() => onSteer(entry), [entry, onSteer]);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => onDragStart(index, event),
    [index, onDragStart],
  );
  const handleReorderKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "ArrowUp" && previousReorderIndex != null) {
      event.preventDefault();
      onReorder(index, previousReorderIndex);
    } else if (event.key === "ArrowDown" && nextReorderIndex != null) {
      event.preventDefault();
      onReorder(index, nextReorderIndex);
    }
  }, [index, nextReorderIndex, onReorder, previousReorderIndex]);

  const stateHint = entry.isSending || isSteering
    ? (
      <ThinkingText
        text={isSteering
          ? CHAT_STREAMING_STATUS_LABELS.steering
          : CHAT_STREAMING_STATUS_LABELS.sending}
        className="shrink-0 text-ui-sm font-normal"
      />
    )
    : entry.isBeingEdited
      ? (
        <span className="shrink-0 text-ui-sm text-faint">
          Editing…
        </span>
      )
      : null;

  return (
    <div
      data-reorder-item
      className={`group/queue-row relative flex items-center justify-between gap-2 py-0.5 pl-4 transition-colors ${
        isDragging ? "opacity-50" : ""
      } ${isDropTarget ? "border-t border-primary" : ""}`}
    >
      {canDragReorder && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Reorder queued message"
          aria-keyshortcuts="ArrowUp ArrowDown"
          className="absolute left-0 flex cursor-grab items-center opacity-0 transition-opacity focus-visible:opacity-70 active:cursor-grabbing group-hover/queue-row:opacity-70"
          onPointerDown={handlePointerDown}
          onKeyDown={handleReorderKeyDown}
        >
          <GripVertical className="icon-paired text-muted-foreground" />
        </Button>
      )}

      <div
        className={`min-w-0 flex-1 whitespace-pre-wrap text-ui transition-colors line-clamp-2 ${
          entry.isBeingEdited ? "text-muted-foreground/60" : "text-muted-foreground"
        }`}
        title={entry.label}
      >
        {entry.label}
      </div>

      {stateHint}

      {!entry.isSending && !isSteering && (
        <div className="flex shrink-0 items-center gap-1">
          {showSteerAction && (
            <Tooltip content="Send next — interrupts the current turn">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={queueMutationInFlight}
                onClick={handleSteer}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Send next — interrupts the current turn"
              >
                <ArrowUpRight className="icon-paired" />
              </Button>
            </Tooltip>
          )}
          {renderEditAction && (
            <Tooltip content={entry.editDisabledReason ?? "Edit message"}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!entry.canEdit || queueMutationInFlight}
                onClick={handleBeginEdit}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Edit queued message"
              >
                <Pencil className="icon-paired" />
              </Button>
            </Tooltip>
          )}
          {renderDeleteAction && (
            <Tooltip content={entry.deleteDisabledReason ?? "Remove from queue"}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!entry.canDelete || queueMutationInFlight}
                onClick={handleDelete}
                className={ROW_ACTION_CLASSNAME}
                aria-label="Delete queued message"
              >
                <X className="icon-paired" />
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
