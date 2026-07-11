import { useEffect, useRef, useState } from "react";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRightActivity } from "@proliferate/ui/icons";
import {
  formatCollapsedActionsSummary,
  resolveCurrentCollapsedAction,
  resolveCollapsedActionsLeadingKind,
  summarizeCollapsedActions,
} from "@proliferate/product-domain/chats/transcript/transcript-collapsed-actions";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { CollapsedActionIcon } from "@/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { CollapsedActionRows } from "@/components/workspace/chat/tool-calls/CollapsedActionRows";

interface CollapsedActionsProps {
  itemIds: string[];
  transcript: TranscriptState;
  autoFollow?: boolean;
  /** Keep the trailing exploration phase visually live between tool events. */
  liveContinuation?: boolean;
}

export function CollapsedActions({
  itemIds,
  transcript,
  autoFollow = false,
  liveContinuation = false,
}: CollapsedActionsProps) {
  const hasActiveAction = itemIds.some((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call"
      && item.status !== "completed"
      && item.status !== "failed";
  });
  const [expanded, setExpanded] = useState(false);
  const actionSummary = summarizeCollapsedActions(itemIds, transcript);
  const containsEdits = actionSummary.edits > 0;
  const shouldAutoFollow = autoFollow || hasActiveAction;
  // Active item status owns ordinary tools. The latest trailing exploration
  // batch can additionally retain phase ownership between back-to-back
  // search/read events; `autoFollow` remains scroll-only.
  const isLiveAction = hasActiveAction || liveContinuation;
  const currentAction = isLiveAction
    ? resolveCurrentCollapsedAction(itemIds, transcript)
    : null;
  const summary = currentAction?.label ?? formatCollapsedActionsSummary(actionSummary);
  const summaryIcon = currentAction
    ? <CollapsedActionIcon kind={currentAction.kind} />
    : <CollapsedActionIcon kind={resolveCollapsedActionsLeadingKind(actionSummary)} />;

  return (
    <div className="flex min-w-0 flex-col text-chat leading-[1.5]">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-chat-transcript-ignore
        data-active={isLiveAction ? "true" : undefined}
        aria-expanded={expanded}
        className="group/collapsed-actions h-auto max-w-full self-start justify-start gap-1 rounded-none bg-transparent p-0 text-left text-chat leading-[1.5] font-normal text-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="inline-flex min-w-0 shrink items-center gap-1.5 truncate">
          <span
            aria-hidden="true"
            className="flex size-[1.143em] shrink-0 items-center justify-center text-current [&_svg]:size-[1.143em] [&_svg]:text-current"
          >
            {summaryIcon}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {isLiveAction
              ? (
                <ThinkingText
                  text={summary}
                  className="block max-w-full truncate font-normal leading-[inherit] !text-current"
                />
              )
              : summary}
          </span>
        </span>
        <ChevronRightActivity
          aria-hidden="true"
          className={`size-[1em] shrink-0 text-current transition-transform duration-300 ${
            expanded
              ? "rotate-90 opacity-100"
              : "opacity-0 group-hover/collapsed-actions:opacity-100 group-focus-visible/collapsed-actions:opacity-100"
          }`}
        />
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
    <div>
      <div
        ref={viewportRef}
        data-collapsed-actions-ledger
        className={containsEdits
          ? "pr-2.5"
          : `overflow-y-auto overflow-x-hidden pr-2.5 ${
            autoFollow ? "max-h-[7.5rem]" : "max-h-80"
          }`}
      >
        <div className="flex flex-col gap-1">
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
