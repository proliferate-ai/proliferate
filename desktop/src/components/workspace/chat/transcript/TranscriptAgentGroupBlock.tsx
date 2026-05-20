import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ToolCallItem,
  ToolResultTextContentPart,
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@/components/ui/icons";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { SubagentLaunchLedger } from "@/components/workspace/chat/transcript/SubagentLaunchLedger";
import { TurnSeparator } from "@/components/workspace/chat/transcript/TurnSeparator";
import {
  ScopedTranscriptBlocks,
} from "@/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tools/tool-call-layout";
import { normalizeToolResultText } from "@/lib/domain/chat/tools/tool-result-text";
import {
  parseAsyncSubagentLaunch,
  parseSubagentLaunchResult,
  parseSubagentProvisioningStatus,
  resolveSubagentExecutionState,
  resolveSubagentLaunchDisplay,
  isSubagentExecutionStateRunning,
  isSubagentWorkComplete,
} from "@/lib/domain/chat/subagents/subagent-launch";
import {
  formatSubagentHeaderVerb,
  isSubagentProvisioningAction,
} from "@/lib/domain/chat/subagents/subagent-tool-presentation";
import {
  buildTranscriptDisplayBlocks,
} from "@/lib/domain/chat/transcript/transcript-presentation";
import {
  findTrailingLiveExplorationBlock,
} from "@/lib/domain/chat/transcript/transcript-rendering";
import { useTranscriptOpenSession } from "./TranscriptContexts";
import {
  collectDescendantItems,
  formatCollapsedSummary,
} from "./TranscriptToolGroupUtils";

export function TranscriptAgentGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  renderChild,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  renderChild: (childId: string) => ReactNode;
}) {
  const executionState = resolveSubagentExecutionState(item);
  const asyncLaunch = parseAsyncSubagentLaunch(item);
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  const launchResult = parseSubagentLaunchResult(item);
  const openSession = useTranscriptOpenSession();
  const isRunning = isSubagentExecutionStateRunning(executionState);
  const isWorkComplete = isSubagentWorkComplete(item);
  const scopedDisplayBlocks = useMemo(
    () => buildTranscriptDisplayBlocks({
      rootIds: childIds,
      transcript,
      childrenByParentId,
      isComplete: isWorkComplete,
    }),
    [childIds, childrenByParentId, isWorkComplete, transcript],
  );
  const liveExplorationBlock = useMemo(
    () => findTrailingLiveExplorationBlock(
      scopedDisplayBlocks,
      transcript,
      !isWorkComplete,
    ),
    [isWorkComplete, scopedDisplayBlocks, transcript],
  );
  const [expanded, setExpanded] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(false);

  const subagentDisplay = resolveSubagentLaunchDisplay(item);
  const normalizedPrompt = subagentDisplay.prompt?.trim() ?? "";

  // Agent synthesis lives in the agent item's own tool_result_text content parts.
  const agentResultText = item.contentParts
    .filter((p): p is ToolResultTextContentPart => p.type === "tool_result_text")
    .map((p) => p.text)
    .join("\n\n");
  const hasProvisioningLedger = isSubagentProvisioningAction(item) && !!provisioningStatus;
  const normalizedAgentResult = hasProvisioningLedger
    ? ""
    : normalizeToolResultText(agentResultText);

  const descendants = collectDescendantItems(childIds, transcript, childrenByParentId);
  const toolCallCount = descendants.filter(
    (entry) => entry.kind === "tool_call",
  ).length;
  const messageCount = descendants.filter(
    (entry) => entry.kind === "assistant_prose" || entry.kind === "thought",
  ).length;
  const workSummary = formatCollapsedSummary({
    messages: messageCount,
    toolCalls: toolCallCount,
    subagents: 0,
  });

  const description = subagentDisplay.title.trim();
  const shouldShowDescription = description.length > 0
    && description.toLowerCase() !== "subagent";
  const hasWork = childIds.length > 0;
  const hasLaunchLedger = !!normalizedPrompt || hasProvisioningLedger;
  const hasBodyContent = hasWork || hasLaunchLedger || !!normalizedAgentResult;
  const renderScopedWork = (
    autoFollowCollapsedActionBlockId: string | null,
  ) => (
    <ScopedTranscriptBlocks
      displayBlocks={scopedDisplayBlocks}
      transcript={transcript}
      autoFollowCollapsedActionBlockId={autoFollowCollapsedActionBlockId}
      renderItem={renderChild}
    />
  );
  const headerVerb = formatSubagentHeaderVerb({ item, executionState, isRunning });
  const collapsedSummary =
    workSummary
    || (executionState === "background"
      ? "Running in background"
      : executionState === "expired_background"
        ? "Stopped updating in background"
      : executionState === "completed_background"
        ? "Completed in background"
      : isRunning
        ? "Working"
        : null);
  const headerExpandable = hasBodyContent;

  return (
    <div className="py-0.5">
      <div
        {...(headerExpandable ? { "data-chat-transcript-ignore": true } : {})}
        onClick={() => headerExpandable && setExpanded(!expanded)}
        className={`group/tool-action-row inline-flex items-center gap-1 rounded-md pl-0.5 pr-1.5 py-1 text-chat leading-[var(--text-chat--line-height)] transition-colors ${
          headerExpandable
            ? "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            : "cursor-default text-muted-foreground"
        }`}
      >
        {headerExpandable && (
          <ChevronRight
            className={`size-2.5 shrink-0 text-faint transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        )}
        <span className="font-[460] text-foreground/90">{headerVerb}</span>
        {shouldShowDescription && (
          <span className="min-w-0 truncate text-foreground/90">{description}</span>
        )}
        {!expanded && collapsedSummary && (
          <span className="ml-1 text-sm text-muted-foreground">
            · {collapsedSummary}
          </span>
        )}
      </div>

      {expanded && hasBodyContent && <div className="ml-1 border-l border-border/70 pl-2">
        {hasLaunchLedger && (
          <SubagentLaunchLedger
            prompt={normalizedPrompt || null}
            provisioningStatus={provisioningStatus}
            executionState={executionState}
            childSessionId={launchResult?.childSessionId ?? null}
            onOpenChild={openSession
              ? (childSessionId) => openSession(childSessionId, "linked-child")
              : undefined}
          />
        )}

        {hasWork && (
          isRunning ? (
            <div className="space-y-1">
              {renderScopedWork(liveExplorationBlock?.blockId ?? null)}
            </div>
          ) : (
            <div className="py-0.5">
              <TurnSeparator
                label={workSummary}
                interactive
                expanded={workExpanded}
                onClick={() => setWorkExpanded(!workExpanded)}
              />
              {workExpanded && (
                <div className="mt-1.5 space-y-1">
                  {renderScopedWork(null)}
                </div>
              )}
            </div>
          )
        )}

        {normalizedAgentResult && (
          asyncLaunch
            ? <AsyncAgentLaunchBlock launch={asyncLaunch} />
            : <AgentResultBlock content={normalizedAgentResult} />
        )}
      </div>}
    </div>
  );
}

const AGENT_RESULT_COLLAPSED_HEIGHT = 200;

function AsyncAgentLaunchBlock({
  launch,
}: {
  launch: { rawText: string; agentId: string | null; outputFile: string | null };
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const hasLaunchDetails = !!launch.agentId || !!launch.outputFile;

  return (
    <div className="mt-1 rounded-md bg-foreground/5 px-3 py-2">
      <div className="text-sm font-medium text-foreground/90">Running in background</div>
      <p className="mt-1 text-sm leading-[var(--text-sm--line-height)] text-muted-foreground">
        You&apos;ll be notified when it finishes.
      </p>
      {hasLaunchDetails && (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-chat-transcript-ignore
            className="-ml-2 h-auto px-2 py-1 text-xs"
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            {detailsExpanded ? "Hide launch details" : "Show launch details"}
          </Button>
          {detailsExpanded && (
            <div className="mt-2 overflow-hidden rounded-md border border-border/60 bg-background/60">
              <AutoHideScrollArea
                className="w-full"
                viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              >
                <div className="whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
                  {launch.rawText}
                </div>
              </AutoHideScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentResultBlock({ content }: { content: string }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setNeedsTruncation(contentRef.current.scrollHeight > AGENT_RESULT_COLLAPSED_HEIGHT);
    }
  }, [content]);

  return (
    <div className="mt-1">
      <div
        className={`relative ${!resultExpanded && needsTruncation ? "overflow-hidden" : ""}`}
        style={!resultExpanded && needsTruncation
          ? { maxHeight: AGENT_RESULT_COLLAPSED_HEIGHT }
          : undefined}
      >
        <div ref={contentRef} className="text-chat leading-[var(--text-chat--line-height)] select-text text-foreground">
          <MarkdownRenderer
            content={content}
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        </div>
        {!resultExpanded && needsTruncation && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <Button
                variant="inverted"
                size="pill"
                data-chat-transcript-ignore
                onClick={() => setResultExpanded(true)}
                className="pointer-events-auto"
              >
                Show full response
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
