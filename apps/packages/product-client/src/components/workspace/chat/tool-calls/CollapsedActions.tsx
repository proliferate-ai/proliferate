import { useState, type CSSProperties } from "react";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { ChevronRightActivity } from "#product/primitives/icons/core";
import {
  formatCollapsedActionsSummary,
  resolveCurrentCollapsedAction,
  resolveCollapsedActionsLeadingKind,
  summarizeCollapsedActions,
} from "#product/domain/chats/transcript/transcript-collapsed-actions";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { useChainedVerticalWheel } from "#product/primitives/utils/use-chained-vertical-wheel";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { CollapsedActionRows } from "#product/components/workspace/chat/tool-calls/CollapsedActionRows";

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
  const [hasExpanded, setHasExpanded] = useState(false);
  const actionSummary = summarizeCollapsedActions(itemIds, transcript);
  const containsEdits = actionSummary.edits > 0;
  const isLiveLedger = autoFollow || hasActiveAction;
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

  function toggleExpanded() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) setHasExpanded(true);
  }

  return (
    <div className="flex min-w-0 flex-col text-chat leading-normal">
      <div className="group/collapsed-actions flex max-w-full self-start items-center gap-1">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          data-active={isLiveAction ? "true" : undefined}
          aria-expanded={expanded}
          className="h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left text-chat leading-normal font-normal text-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:text-foreground"
          onClick={toggleExpanded}
        >
          <span className="inline-flex min-w-0 shrink items-center gap-1.5 truncate">
            <span
              aria-hidden="true"
              className="icon-paired flex shrink-0 items-center justify-center text-current [&_svg]:size-full [&_svg]:text-current"
            >
              {summaryIcon}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {isLiveAction
                ? (
                  <ThinkingText
                    text={summary}
                    className="block max-w-full truncate font-normal !text-current"
                  />
                )
                : summary}
            </span>
          </span>
          <ChevronRightActivity
            aria-hidden="true"
            className={`icon-compact shrink-0 text-current transition-transform duration-disclosure ${
              expanded
                ? "rotate-90 opacity-100"
                : "opacity-0 group-hover/collapsed-actions:opacity-100 group-focus-visible/collapsed-actions:opacity-100"
            }`}
          />
        </Button>
      </div>
      <AnimatedCollapsibleContent expanded={expanded}>
        <div className="mt-1 flex flex-col gap-1">
          {hasExpanded ? (
            <CollapsedActionsLedger
              itemIds={itemIds}
              transcript={transcript}
              isLive={isLiveLedger}
              containsEdits={containsEdits}
            />
          ) : null}
        </div>
      </AnimatedCollapsibleContent>
    </div>
  );
}

function CollapsedActionsLedger({
  itemIds,
  transcript,
  isLive,
  containsEdits,
}: Pick<CollapsedActionsProps, "itemIds" | "transcript"> & { isLive: boolean; containsEdits: boolean }) {
  const handleLedgerWheel = useChainedVerticalWheel();
  return (
    <div>
      <div
        data-collapsed-actions-ledger
        data-live={isLive ? "true" : undefined}
        onWheel={containsEdits ? undefined : handleLedgerWheel}
        style={containsEdits
          ? undefined
          : { "--edge-fade-distance": "3rem" } as CSSProperties}
        className={containsEdits
          ? "pr-2.5"
          : "vertical-scroll-fade-mask max-h-56 overscroll-none overflow-y-auto overflow-x-hidden pr-2.5"}
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
