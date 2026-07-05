import { useState } from "react";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Robot } from "@proliferate/ui/icons";
import { MarkdownRenderer } from "@/components/content/ui/MarkdownRenderer";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
  isSubagentWorkComplete,
} from "@proliferate/product-domain/chats/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import { useTranscriptOpenSession } from "./TranscriptContexts";

const CHAT_BUTTON_TEXT_CLASS = "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function SubagentCreationGroupBlock({
  itemIds,
  transcript,
}: {
  itemIds: readonly string[];
  transcript: TranscriptState;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = itemIds
    .map((itemId) => transcript.itemsById[itemId])
    .filter((item): item is ToolCallItem => item?.kind === "tool_call");

  // Filter to only show finished subagents in the transcript.
  // Running subagents appear only in the composer ⑂ roster.
  const finishedItems = items.filter((item) => isSubagentWorkComplete(item));
  const openSession = useTranscriptOpenSession();
  const summary = finishedItems.length === 1 ? "Subagent finished" : `${finishedItems.length} subagents finished`;

  if (finishedItems.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        className={`group/collapsed-actions h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline`}
        aria-expanded={expanded}
        onClick={() => setExpanded((next) => !next)}
      >
        <Robot
          aria-hidden="true"
          className={`size-3 shrink-0 transition-colors ${
            expanded
              ? "text-foreground/70"
              : "text-faint group-hover/collapsed-actions:text-muted-foreground group-focus-visible/collapsed-actions:text-muted-foreground"
          }`}
        />
        <span className="min-w-0 truncate">{summary}</span>
      </Button>
      {expanded && (
        <div className="ml-1 space-y-1 border-l border-border/70 pl-2">
          {finishedItems.map((item) => (
            <SubagentFinishedRow
              key={item.itemId}
              item={item}
              parentTitle={transcript.sessionMeta.title ?? "Parent session"}
              onOpenChild={openSession
                ? (childSessionId) => openSession(childSessionId, "linked-child")
                : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A quiet, collapsible line for a finished subagent showing the clean result
 * summary the parent agent used. The line reads "⑂ <task title> — done" and
 * expands to show the subagent's summary field (never the raw orchestration
 * metadata).
 */
function SubagentFinishedRow({
  item,
  onOpenChild,
}: {
  item: ToolCallItem;
  parentTitle: string;
  onOpenChild?: (childSessionId: string) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const launchDisplay = resolveSubagentLaunchDisplay(item);
  const launchResult = parseSubagentLaunchResult(item);
  const identity = buildDelegatedAgentIdentity({
    id: item.toolCallId ?? item.itemId,
    title: launchDisplay.title,
    sessionId: launchResult?.childSessionId ?? null,
    sessionLinkId: launchResult?.sessionLinkId ?? item.toolCallId ?? item.itemId,
  });
  const canOpenChild = !!launchResult?.childSessionId && !!onOpenChild;
  const isFailed = item.status === "failed";

  // Extract the clean summary from the rawOutput JSON (the structured result the
  // parent agent received), not the raw tool_result_text contentParts (which may
  // contain internal orchestration metadata).
  const rawOutput = typeof item.rawOutput === "object" && item.rawOutput !== null
    ? item.rawOutput as Record<string, unknown>
    : null;
  const summary = typeof rawOutput?.summary === "string" && rawOutput.summary.trim().length > 0
    ? rawOutput.summary.trim()
    : null;

  const openChild = () => {
    if (canOpenChild && launchResult?.childSessionId) {
      onOpenChild(launchResult.childSessionId);
    }
  };

  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        className={`group/subagent-done h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline`}
        aria-expanded={detailsExpanded}
        onClick={() => setDetailsExpanded((next) => !next)}
      >
        <Robot
          aria-hidden="true"
          className={`size-3 shrink-0 transition-colors ${
            detailsExpanded
              ? "text-foreground/70"
              : isFailed
                ? "text-destructive/60"
                : "text-faint group-hover/subagent-done:text-muted-foreground group-focus-visible/subagent-done:text-muted-foreground"
          }`}
        />
        <span className="min-w-0 truncate">
          {identity.displayName} — {isFailed ? "failed" : "done"}
        </span>
      </Button>
      {detailsExpanded && (
        <div className="ml-1 mt-1 space-y-1 border-l border-border/70 pl-2">
          {canOpenChild && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-chat-transcript-ignore
              className={`h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
              onClick={openChild}
            >
              <span className="min-w-0 truncate">Open subagent session</span>
            </Button>
          )}
          {summary && (
            <div className="text-chat leading-[var(--text-chat--line-height)] text-foreground/90">
              <MarkdownRenderer
                content={summary}
                className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
