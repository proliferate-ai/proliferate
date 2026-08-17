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
import { ChevronRight } from "#product/primitives/icons/core";
import { Robot } from "#product/primitives/icons/product";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { renderDesktopCodeBlock } from "#product/components/content/ui/desktop-markdown-code-block";
import { AgentIdentityChip } from "#product/components/patterns/AgentIdentityChip";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { SubagentLaunchLedger } from "#product/components/workspace/chat/transcript/SubagentLaunchLedger";
import { TurnSeparator } from "#product/components/workspace/chat/transcript/TurnSeparator";
import {
  ScopedTranscriptBlocks,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import {
  resolveSubagentExecutionState,
  resolveSubagentIdForItem,
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
  workspaceId = null,
  onOpenSubagent,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  renderChild: (childId: string) => ReactNode;
  /** Feeds the generated identity's `openTarget`; absent for embedded/read-only transcripts. */
  workspaceId?: string | null;
  /**
   * Opens this native subagent's `BackgroundWorkPane` detail
   * (`BackgroundSubagentView`) — the spec's "native routing" intent,
   * delivered here rather than at `SpawnIdentityReceipt` (that component is
   * delegated-work-only; see the PR body's disclosed spec correction).
   * Absent for embedded/read-only transcripts that have no pane to open.
   */
  onOpenSubagent?: (subagentId: string) => void;
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
  // Native-routing affordance (Delivery Spec — Background Work Slice 1, rung
  // R4 fix-forward): only a block whose `rawOutput` actually carries the
  // background-work correlation gets the click-to-open-pane behavior — a
  // block with no `subagentId` (no correlation available for this harness,
  // or no pane consumer wired at this transcript's call site) falls back to
  // today's byte-identical expand/collapse-on-click header.
  const subagentId = resolveSubagentIdForItem(item);
  const canOpenSubagent = Boolean(onOpenSubagent && subagentId);
  // Founder critique (2026-08-17): a native launch used to fall back to this
  // same generic "Creating subagent … · 1 tool call" header. Once the wire
  // carries a durable subagentId, the design artifact's identity treatment
  // (`AgentIdentityChip` + a "started working"-style verb, matching
  // `SubagentCreationGroupBlock`'s creation-run anatomy) replaces it so this
  // block agrees with the pane roster row and detail header, which already
  // build the same generated identity from the same id (rung R4).
  const nativeIdentity = canOpenSubagent && subagentId
    ? buildDelegatedAgentIdentity({
      id: subagentId,
      title: subagentDisplay.title,
      workspaceId,
      sessionId: subagentId,
    })
    : null;
  const nativeCreationVerb = executionState === "failed"
    ? "failed to start"
    : isRunning
      ? "starting"
      : "started working";
  const headerClickable = canOpenSubagent || headerExpandable;
  // Keyboard access (review round 3): the header used to be a pure
  // expand/collapse toggle, where losing keyboard access was a pre-existing
  // gap; now it can navigate away to a subagent's pane, which makes keyboard
  // parity load-bearing. `activateHeader` is the single source of truth for
  // "what does activating this header do," shared by the pointer and
  // keyboard paths so they can never drift apart.
  const activateHeader = () => {
    if (onOpenSubagent && subagentId) {
      onOpenSubagent(subagentId);
      return;
    }
    if (headerExpandable) {
      setExpanded(!expanded);
    }
  };
  // Distinct wording from the chevron's own "Expand/Collapse subagent
  // details" label (kept as-is below, per handoff) — the two controls are
  // mutually exclusive in the DOM (the chevron only renders alongside a
  // clickable header when `canOpenSubagent`), but giving them identical
  // accessible names would still be confusing for anyone landing on either
  // by name, and it collides with `getByRole("button", { name: … })`
  // lookups that target the chevron specifically.
  const headerAriaLabel = canOpenSubagent
    ? "Open subagent detail"
    : headerExpandable
      ? (expanded ? "Hide subagent details" : "Show subagent details")
      : undefined;

  return (
    <div className="py-0.5">
      {nativeIdentity && subagentId ? (
        <div
          data-subagent-creation-run
          className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-chat leading-8"
        >
          <AgentIdentityChip
            identity={nativeIdentity}
            onOpen={() => onOpenSubagent?.(subagentId)}
          />
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            data-chat-transcript-ignore
            onClick={() => onOpenSubagent?.(subagentId)}
            className={`relative top-px inline-block cursor-pointer align-middle hover:underline focus-visible:underline ${
              executionState === "failed" ? "text-destructive/80" : "text-foreground/90"
            }`}
          >
            {nativeCreationVerb}
          </Button>
          {hasBodyContent && (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              data-chat-transcript-ignore
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse subagent details" : "Expand subagent details"}
              onClick={() => setExpanded(!expanded)}
              className="flex shrink-0 items-center justify-center rounded p-0.5 text-faint hover:bg-muted/40 hover:text-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className={`icon-compact shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </Button>
          )}
        </div>
      ) : (
        <div
          {...(headerClickable
            ? {
                "data-chat-transcript-ignore": true,
                role: "button" as const,
                tabIndex: 0,
                "aria-label": headerAriaLabel,
              }
            : {})}
          onClick={activateHeader}
          onKeyDown={(event) => {
            // Ignore keydown bubbling up from the nested chevron `Button`
            // below — it's a real, independently-focusable `<button>`, and
            // its own Enter/Space activation must not also re-trigger this
            // header's action.
            if (!headerClickable || event.target !== event.currentTarget) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              activateHeader();
            }
          }}
          className={`group/tool-action-row inline-flex items-center gap-1 rounded-md pl-0.5 pr-1.5 py-1 text-chat transition-colors ${
            headerClickable
              ? "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              : "cursor-default text-muted-foreground"
          }`}
        >
          <Robot
            aria-hidden="true"
            className={`icon-compact shrink-0 transition-colors ${
              expanded
                ? "text-foreground/70"
                : headerClickable
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
      )}

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
