import { useMemo, useState, type ReactNode } from "react";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { Robot, Spinner } from "@proliferate/ui/icons";
import { buildTranscriptDisplayBlocks } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import { findTrailingLiveExplorationBlock } from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  resolveSubagentExecutionState,
  resolveSubagentLaunchDisplay,
  isSubagentExecutionStateRunning,
  type SubagentExecutionState,
} from "@proliferate/product-domain/chats/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import { ScopedTranscriptBlocks } from "./ScopedTranscriptBlocks";
import { DelegatedAgentHoverCard } from "@/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import {
  collectDescendantItems,
  formatCollapsedSummary,
} from "./TranscriptToolGroupUtils";

/**
 * Renders a native-harness (Claude Task) subagent's own work that streamed in
 * AFTER its launching `Agent` tool call — the background/async case, where the
 * inner tool calls arrive in a later turn than the launch and would otherwise
 * leak into the main thread as loose actions ("Agent #3 done — …"). The domain
 * groups those orphaned roots into a `subagent_activity` block keyed by the
 * launching `parentToolCallId`; this component draws that block as one bounded
 * unit with a start → running → ended lifecycle and a collapsible drill-in.
 *
 * The launching Agent item is looked up in `transcript.itemsById` (it lives in
 * an earlier turn but the transcript state keeps every turn's items) to reuse
 * its identity and infer lifecycle. When the launch record isn't available
 * (e.g. a resumed session that never replayed it), we degrade gracefully to a
 * generic subagent identity and treat any in-progress inner work as running.
 */
export function TranscriptSubagentActivityBlock({
  parentToolCallId,
  itemIds,
  transcript,
  childrenByParentId,
  renderChild,
}: {
  parentToolCallId: string;
  itemIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  renderChild: (childId: string) => ReactNode;
}) {
  const launchItem = resolveLaunchItem(transcript, parentToolCallId);

  // Lifecycle: prefer the launch item's own execution state (covers the
  // background pending → completed transition written by the runtime). If the
  // launch record isn't loaded, fall back to inferring from the inner work.
  const inferredRunning = useMemo(
    () => itemIds.some((itemId) => {
      const item = transcript.itemsById[itemId];
      return item?.kind === "tool_call" && item.status === "in_progress";
    }),
    [itemIds, transcript],
  );
  const executionState: SubagentExecutionState = launchItem
    ? resolveSubagentExecutionState(launchItem)
    : inferredRunning
      ? "running"
      : "completed";
  const isRunning = launchItem
    ? isSubagentExecutionStateRunning(executionState)
    : inferredRunning;
  const isFailed = executionState === "failed";

  const launchDisplay = launchItem ? resolveSubagentLaunchDisplay(launchItem) : null;
  const identity = buildDelegatedAgentIdentity({
    id: parentToolCallId,
    title: launchDisplay?.title ?? "Subagent",
    sessionId: null,
    sessionLinkId: parentToolCallId,
  });

  const scopedDisplayBlocks = useMemo(
    () => buildTranscriptDisplayBlocks({
      rootIds: itemIds,
      transcript,
      childrenByParentId,
      isComplete: !isRunning,
    }),
    [itemIds, childrenByParentId, isRunning, transcript],
  );
  const liveExplorationBlock = useMemo(
    () => findTrailingLiveExplorationBlock(scopedDisplayBlocks, transcript, isRunning),
    [scopedDisplayBlocks, transcript, isRunning],
  );

  const descendants = collectDescendantItems(itemIds, transcript, childrenByParentId);
  const toolCallCount = descendants.filter((entry) => entry.kind === "tool_call").length;
  const messageCount = descendants.filter(
    (entry) => entry.kind === "assistant_prose" || entry.kind === "thought",
  ).length;
  const workSummary = formatCollapsedSummary({
    messages: messageCount,
    toolCalls: toolCallCount,
    subagents: 0,
  });

  // Once ended, default to collapsed (the whole point: don't read as chat).
  // While running, default to expanded so live progress stays visible.
  const [expanded, setExpanded] = useState(isRunning);
  const shouldExpand = isRunning || expanded;

  const statusChip = <SubagentActivityStatusChip isRunning={isRunning} isFailed={isFailed} />;
  const description = launchDisplay?.title?.trim() ?? "";
  const shouldShowDescription = description.length > 0
    && description.toLowerCase() !== "subagent";

  const hoverAgent = {
    identity,
    kind: "subagent" as const,
    originLabel: "Subagent",
    statusCategory: isFailed ? ("failed" as const) : isRunning ? ("running" as const) : ("finished" as const),
    statusLabel: isFailed ? "Failed" : isRunning ? "Working" : "Done",
    parentTitle: transcript.sessionMeta.title ?? null,
    hoverTitle: [
      identity.displayName,
      "Subagent",
      transcript.sessionMeta.title ? `Parent: ${transcript.sessionMeta.title}` : null,
      isFailed ? "Failed" : isRunning ? "Working" : "Done",
    ].filter((value): value is string => !!value).join("\n"),
  };

  return (
    <div className="py-0.5" data-subagent-activity={parentToolCallId}>
      <div
        {...(isRunning ? {} : { "data-chat-transcript-ignore": true })}
        onClick={() => !isRunning && setExpanded((next) => !next)}
        className={`group/subagent-activity inline-flex max-w-full items-center gap-1.5 rounded-md pl-0.5 pr-1.5 py-1 text-chat leading-[var(--text-chat--line-height)] transition-colors ${
          isRunning
            ? "cursor-default text-muted-foreground"
            : "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        }`}
      >
        <Robot
          aria-hidden="true"
          className={`size-3 shrink-0 ${identity.textColorClassName}`}
        />
        <DelegatedAgentHoverCard agent={hoverAgent} cardAriaLabel={identity.displayName}>
          <span className={`shrink-0 truncate font-medium ${identity.textColorClassName}`}>
            {identity.generatedName}
          </span>
        </DelegatedAgentHoverCard>
        <span className="shrink-0 text-inherit">
          {isRunning ? "working" : isFailed ? "failed" : "finished"}
        </span>
        {shouldShowDescription && (
          <span className="min-w-0 truncate text-inherit">· {description}</span>
        )}
        {statusChip}
        {!shouldExpand && workSummary && (
          <span className="ml-0.5 truncate text-sm text-muted-foreground">· {workSummary}</span>
        )}
      </div>

      {shouldExpand && itemIds.length > 0 && (
        <div className="ml-1 space-y-1 border-l border-border/70 pl-2">
          <ScopedTranscriptBlocks
            displayBlocks={scopedDisplayBlocks}
            transcript={transcript}
            autoFollowCollapsedActionBlockId={liveExplorationBlock?.blockId ?? null}
            renderItem={renderChild}
          />
        </div>
      )}
    </div>
  );
}

function SubagentActivityStatusChip({
  isRunning,
  isFailed,
}: {
  isRunning: boolean;
  isFailed: boolean;
}) {
  if (isRunning) {
    return (
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Spinner className="size-2.5" />
        Running
      </span>
    );
  }
  if (isFailed) {
    return (
      <span className="ml-1 inline-flex shrink-0 items-center rounded-full bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
        Failed
      </span>
    );
  }
  return (
    <span className="ml-1 inline-flex shrink-0 items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">
      Ended
    </span>
  );
}

function resolveLaunchItem(
  transcript: TranscriptState,
  parentToolCallId: string,
): ToolCallItem | null {
  const item = transcript.itemsById[parentToolCallId];
  return item?.kind === "tool_call" ? item : null;
}
