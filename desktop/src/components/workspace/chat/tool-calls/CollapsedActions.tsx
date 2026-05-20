import { useEffect, useRef, useState } from "react";
import type {
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@/components/ui/icons";
import {
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "@/lib/domain/chat/transcript/transcript-collapsed-actions";
import { CollapsedActionRows } from "@/components/workspace/chat/tool-calls/CollapsedActionRows";

const CHAT_BUTTON_TEXT_CLASS = "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

interface CollapsedActionsProps {
  itemIds: string[];
  transcript: TranscriptState;
  autoFollow?: boolean;
}

export function CollapsedActions({
  itemIds,
  transcript,
  autoFollow = false,
}: CollapsedActionsProps) {
  const hasActiveExploration = itemIds.some((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call"
      && item.status !== "completed"
      && item.status !== "failed";
  });
  const [expanded, setExpanded] = useState(false);
  const actionSummary = summarizeCollapsedActions(itemIds, transcript);
  const summary = formatCollapsedActionsSummary(actionSummary);
  const containsEdits = actionSummary.edits > 0;
  const shouldAutoFollow = autoFollow || hasActiveExploration;

  return (
    <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        aria-expanded={expanded}
        className={`group/collapsed-actions h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline`}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3 shrink-0 text-faint opacity-75 transition-transform duration-200 group-hover/collapsed-actions:text-muted-foreground group-focus-visible/collapsed-actions:text-muted-foreground ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0 truncate">{summary}</span>
      </Button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          <CollapsedActionsLedger
            itemIds={itemIds}
            transcript={transcript}
            autoFollow={shouldAutoFollow}
            containsEdits={containsEdits}
          />
        </div>
      )}
    </div>
  );
}

export function InlineToolAction({ item }: { item: ToolCallItem }) {
  return (
    <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
      <CollapsedActionRows item={item} />
    </div>
  );
}

export function InlineToolActions({
  itemIds,
  transcript,
}: {
  itemIds: string[];
  transcript: TranscriptState;
}) {
  const actionSummary = summarizeCollapsedActions(itemIds, transcript);
  const containsEdits = actionSummary.edits > 0;

  return (
    <div className={containsEdits ? "flex flex-col gap-0" : "flex flex-col gap-1"}>
      {itemIds.map((itemId) => {
        const item = transcript.itemsById[itemId];
        if (item?.kind !== "tool_call") return null;
        return <InlineToolAction key={itemId} item={item} />;
      })}
    </div>
  );
}

function CollapsedActionsLedger({
  itemIds,
  transcript,
  autoFollow,
  containsEdits,
}: Pick<CollapsedActionsProps, "itemIds" | "transcript"> & { autoFollow: boolean; containsEdits: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemSignature = itemIds.join("|");
  const shouldScrollLedger = !containsEdits;

  useEffect(() => {
    if (!autoFollow || !shouldScrollLedger) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [autoFollow, itemSignature, shouldScrollLedger, transcript]);

  return (
    <div className="-mx-2.5">
      <div
        ref={viewportRef}
        data-collapsed-actions-ledger
        className={containsEdits
          ? "pl-4 pr-2.5"
          : `overflow-y-auto overflow-x-hidden pl-4 pr-2.5 ${
            autoFollow ? "max-h-[7.5rem]" : "max-h-80"
          }`}
      >
        <div className={containsEdits ? "flex flex-col gap-0" : "flex flex-col gap-1"}>
          {itemIds.map((itemId) => {
            const item = transcript.itemsById[itemId];
            if (item?.kind !== "tool_call") return null;
            return <CollapsedActionRows key={itemId} item={item} />;
          })}
        </div>
      </div>
    </div>
  );
}
