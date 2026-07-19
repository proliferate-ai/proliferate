import { useState, type CSSProperties } from "react";
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
import { ThinkingText } from "#product/components/feedback/ThinkingText";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { CollapsedActionRows } from "#product/components/workspace/chat/tool-calls/CollapsedActionRows";

interface CollapsedActionsProps {
  itemIds: string[];
  transcript: TranscriptState;
  autoFollow?: boolean;
  /** Keep the trailing exploration phase visually live between tool events. */
  liveContinuation?: boolean;
  onOpenChanges?: () => void;
}

export function CollapsedActions({
  itemIds,
  transcript,
  autoFollow = false,
  liveContinuation = false,
  onOpenChanges,
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
  const summaryOpensChanges = containsEdits && Boolean(onOpenChanges) && !isLiveAction;

  return (
    <div className="flex min-w-0 flex-col text-chat leading-[1.5]">
      <div className="group/collapsed-actions flex max-w-full self-start items-center gap-1">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          data-active={isLiveAction ? "true" : undefined}
          aria-expanded={summaryOpensChanges ? undefined : expanded}
          title={summaryOpensChanges ? "Open changes" : undefined}
          className="h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left text-chat leading-[1.5] font-normal text-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:text-foreground"
          onClick={summaryOpensChanges
            ? onOpenChanges
            : () => setExpanded((value) => !value)}
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
          {!summaryOpensChanges && (
            <ChevronRightActivity
              aria-hidden="true"
              className={`size-[1em] shrink-0 text-current transition-transform duration-300 ${
                expanded
                  ? "rotate-90 opacity-100"
                  : "opacity-0 group-hover/collapsed-actions:opacity-100 group-focus-visible/collapsed-actions:opacity-100"
              }`}
            />
          )}
        </Button>
        {summaryOpensChanges && (
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            data-chat-transcript-ignore
            aria-label={expanded ? "Collapse edited files" : "Expand edited files"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="size-[1em] shrink-0 rounded-none bg-transparent p-0 text-current hover:bg-transparent focus-visible:text-foreground"
          >
            <ChevronRightActivity
              aria-hidden="true"
              className={`size-[1em] text-current transition-transform duration-300 ${
                expanded
                  ? "rotate-90 opacity-100"
                  : "opacity-0 group-hover/collapsed-actions:opacity-100 group-focus-visible/collapsed-actions:opacity-100"
              }`}
            />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          <CollapsedActionsLedger
            itemIds={itemIds}
            transcript={transcript}
            isLive={isLiveLedger}
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
  isLive,
  containsEdits,
}: Pick<CollapsedActionsProps, "itemIds" | "transcript"> & { isLive: boolean; containsEdits: boolean }) {
  return (
    <div>
      <div
        data-collapsed-actions-ledger
        data-live={isLive ? "true" : undefined}
        style={containsEdits
          ? undefined
          : { "--edge-fade-distance": "3rem" } as CSSProperties}
        className={containsEdits
          ? "pr-2.5"
          : "vertical-scroll-fade-mask max-h-56 overflow-y-auto overflow-x-hidden pr-2.5"}
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
