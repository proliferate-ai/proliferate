import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { Robot } from "#product/primitives/icons/product";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { renderDesktopCodeBlock } from "#product/components/content/ui/desktop-markdown-code-block";
import { SubagentLaunchLedger } from "#product/components/workspace/chat/transcript/SubagentLaunchLedger";
import { TurnSeparator } from "#product/components/workspace/chat/transcript/TurnSeparator";
import {
  ScopedTranscriptBlocks,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import {
  resolveSubagentExecutionState,
  resolveSubagentLaunchDisplay,
  isSubagentExecutionStateRunning,
  isSubagentLaunchStatusVisibleInTranscript,
  isSubagentWorkComplete,
} from "#product/domain/chats/subagents/subagent-launch";
import {
  buildTranscriptDisplayBlocks,
} from "#product/domain/chats/transcript/transcript-presentation";
import {
  collectDescendantItems,
  formatCollapsedSummary,
} from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";

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
  const [expanded, setExpanded] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(false);

  // The initial prompt this display used to surface is no longer shown
  // inline (Design Handoff — MODIFIED `SubagentLaunchLedger`; Delivery Spec
  // — Background Work Slice 1, rung R4): it moved to
  // `BackgroundSubagentView`'s dedicated "Initial prompt" panel, reached via
  // the activity roster, not this transcript group.
  const subagentDisplay = resolveSubagentLaunchDisplay(item);

  // Only ever surface the structured `rawOutput.summary` — the clean result
  // the parent agent received. NEVER the raw tool_result_text content parts:
  // those can carry the internal orchestration launch receipt ("Async agent
  // launched successfully… agentId… output_file… Do NOT Read or tail this
  // file…") which must never reach the human transcript.
  const rawOutputRecord = isRecord(item.rawOutput) ? item.rawOutput : null;
  const summaryText = typeof rawOutputRecord?.summary === "string"
    ? rawOutputRecord.summary.trim()
    : "";
  const normalizedAgentResult = summaryText;

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
  const hasLaunchLedger = isSubagentLaunchStatusVisibleInTranscript(executionState);
  const hasBodyContent = hasWork || hasLaunchLedger || !!normalizedAgentResult;
  // The activity roster is a session-level summary. This durable transcript
  // item is the canonical place to inspect the native subagent's nested work.
  const renderScopedWork = () => (
    <ScopedTranscriptBlocks
      displayBlocks={scopedDisplayBlocks}
      transcript={transcript}
      autoFollowCollapsedActionBlockId={null}
      renderItem={renderChild}
    />
  );
  const headerVerb = executionState === "failed"
    ? "Subagent launch failed"
    : isRunning
      ? "Creating subagent"
      : "Subagent created";
  const collapsedSummary =
    workSummary
    || (executionState === "expired_background"
      ? "Stopped updating in background"
      : executionState === "completed_background"
        ? "Completed in background"
        : null);
  const headerExpandable = hasBodyContent;

  return (
    <div className="py-0.5">
      <div
        {...(headerExpandable ? { "data-chat-transcript-ignore": true } : {})}
        onClick={() => headerExpandable && setExpanded(!expanded)}
        className={`group/tool-action-row inline-flex items-center gap-1 rounded-md pl-0.5 pr-1.5 py-1 text-chat transition-colors ${
          headerExpandable
            ? "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            : "cursor-default text-muted-foreground"
        }`}
      >
        <Robot
          aria-hidden="true"
          className={`icon-compact shrink-0 transition-colors ${
            expanded
              ? "text-foreground/70"
              : headerExpandable
                ? "text-faint group-hover/tool-action-row:text-muted-foreground"
                : "text-muted-foreground"
          }`}
        />
        <span className="text-inherit">{headerVerb}</span>
        {shouldShowDescription && (
          <span className="min-w-0 truncate text-inherit">{description}</span>
        )}
        {!expanded && collapsedSummary && (
          <span className="ml-1 text-chat text-muted-foreground">
            · {collapsedSummary}
          </span>
        )}
      </div>

      {expanded && hasBodyContent && <div className="ml-1 border-l border-border/70 pl-2">
        {hasLaunchLedger && (
          <SubagentLaunchLedger executionState={executionState} />
        )}

        {hasWork && (
          <div className="py-0.5">
            <TurnSeparator
              label={workSummary}
              interactive
              expanded={workExpanded}
              onClick={() => setWorkExpanded(!workExpanded)}
            />
            {workExpanded && (
              <div className="mt-1.5 space-y-1">
                {renderScopedWork()}
              </div>
            )}
          </div>
        )}

        {normalizedAgentResult && (
          <AgentResultBlock content={normalizedAgentResult} />
        )}
      </div>}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const AGENT_RESULT_COLLAPSED_HEIGHT = 200;

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
        <div ref={contentRef} className="text-chat select-text text-foreground">
          <MarkdownBody
            content={content}
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            renderCodeBlock={renderDesktopCodeBlock}
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
