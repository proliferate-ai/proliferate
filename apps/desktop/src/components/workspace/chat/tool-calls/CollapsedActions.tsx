import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  FilePen,
  FileText,
  FolderList,
  Search,
  Settings,
  SquareTerminal,
} from "@proliferate/ui/icons";
import {
  type CollapsedActionSummary,
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "@proliferate/product-domain/chats/transcript/transcript-collapsed-actions";
import { ThinkingText } from "@/components/feedback/ThinkingText";
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
  const hasActiveAction = itemIds.some((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call"
      && item.status !== "completed"
      && item.status !== "failed";
  });
  const [expanded, setExpanded] = useState(false);
  const actionSummary = summarizeCollapsedActions(itemIds, transcript);
  const summaryIcon = renderCollapsedActionsIcon(actionSummary);
  const containsEdits = actionSummary.edits > 0;
  const shouldAutoFollow = autoFollow || hasActiveAction;
  const isLiveAction = autoFollow || hasActiveAction;
  const summary = formatCollapsedActionsSummary(actionSummary, { active: isLiveAction });

  return (
    <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        data-active={isLiveAction ? "true" : undefined}
        aria-expanded={expanded}
        className={`group/collapsed-actions h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline ${
          isLiveAction ? "text-muted-foreground/75" : "text-muted-foreground/60"
        }`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          aria-hidden="true"
          className={`flex size-3 shrink-0 items-center justify-center transition-colors [&_svg]:size-2.5 ${
            expanded
              ? "text-foreground/70"
              : "text-faint group-hover/collapsed-actions:text-muted-foreground group-focus-visible/collapsed-actions:text-muted-foreground"
          }`}
        >
          {summaryIcon}
        </span>
        <span className="min-w-0 truncate">
          {isLiveAction
            ? (
              <ThinkingText
                text={summary}
                className="block max-w-full truncate font-normal leading-[inherit]"
              />
            )
            : summary}
        </span>
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

function renderCollapsedActionsIcon(summary: CollapsedActionSummary): ReactNode {
  if (summary.commands > 0) {
    return <SquareTerminal />;
  }
  if (summary.edits > 0) {
    return <FilePen />;
  }
  if (summary.searches > 0) {
    return <Search />;
  }
  if (summary.listings > 0) {
    return <FolderList />;
  }
  if (summary.reads > 0 || summary.fetches > 0) {
    return <FileText />;
  }
  return <Settings />;
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
