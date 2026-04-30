import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AssistantMessage } from "./AssistantMessage";
import { ClaudePlanCard } from "./ClaudePlanCard";
import { ConnectedProposedPlanItem } from "./ConnectedProposedPlanItem";
import { CopyMessageButton } from "./CopyMessageButton";
import { SystemMessage } from "./SystemMessage";
import { UserMessage } from "./UserMessage";
import { StreamingIndicator } from "./StreamingIndicator";
import { TurnSeparator } from "./TurnSeparator";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import { GenericToolResultRow } from "@/components/workspace/chat/tool-calls/GenericToolResultRow";
import { ToolActionLeadingAffordance } from "@/components/workspace/chat/tool-calls/ToolActionRow";
import { BashCommandCall } from "@/components/workspace/chat/tool-calls/BashCommandCall";
import { FileChangeCall } from "@/components/workspace/chat/tool-calls/FileChangeCall";
import { FileReadCall } from "@/components/workspace/chat/tool-calls/FileReadCall";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import { CoworkArtifactToolActionRow } from "@/components/workspace/chat/tool-calls/CoworkArtifactToolActionRow";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import { CoworkCodingToolActionRow } from "@/components/workspace/chat/tool-calls/cowork/CoworkCodingToolActionRow";
import { TurnDiffPanel } from "./TurnDiffPanel";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  ClipboardList,
  CircleQuestion,
  FilePen,
  FilePlus,
  FileText,
  FolderList,
  ProliferateIcon,
  Settings,
  Sparkles,
  Terminal,
} from "@/components/ui/icons";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useMessageListScroll } from "@/hooks/chat/use-message-list-scroll";
import { useOpenCoworkArtifact } from "@/hooks/cowork/use-open-cowork-artifact";
import { useOpenCoworkCodingSession } from "@/hooks/cowork/use-open-cowork-coding-session";
import { useChatTranscriptSelection } from "@/hooks/chat/use-chat-transcript-selection";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useBrailleFillsweep } from "@/hooks/ui/use-braille-sweep";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@/lib/domain/chat/cowork-artifact-tool-presentation";
import {
  describeToolCallDisplay,
  type ToolDisplayIconKey,
} from "@/lib/domain/chat/tool-call-display";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";
import {
  buildTranscriptDisplayBlocks,
  buildTurnPresentation,
  summarizeCollapsedActions,
  type TurnDisplayBlock,
} from "@/lib/domain/chat/transcript-presentation";
import { buildTranscriptCopyText } from "@/lib/domain/chat/transcript-copy";
import { normalizeToolResultText } from "@/lib/domain/chat/tool-result-text";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/claude-plan-tool-call";
import {
  parseAsyncSubagentLaunch,
  parseSubagentLaunchResult,
  parseSubagentProvisioningStatus,
  resolveSubagentLaunchDisplay,
  resolveSubagentExecutionState,
  isSubagentExecutionStateRunning,
  isSubagentWorkComplete,
  type SubagentExecutionState,
} from "@/lib/domain/chat/subagent-launch";
import {
  buildSubagentBrailleColorMap,
  resolveSubagentColor,
  resolveSubagentBrailleColor,
} from "@/lib/domain/chat/subagent-braille-color";
import {
  isAgentSessionProvenance,
  resolveReviewFeedbackPromptReference,
  isSubagentWakeProvenance,
} from "@/lib/domain/chat/subagents/provenance";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { SubagentWakeBadge } from "@/components/workspace/chat/transcript/SubagentWakeBadge";
import { ReviewFeedbackSummary } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import { SubagentLaunchLedger } from "@/components/workspace/chat/transcript/SubagentLaunchLedger";
import { SessionErrorItem } from "@/components/workspace/chat/transcript/SessionErrorItem";
import { UserMessageProvenanceChrome } from "@/components/workspace/chat/transcript/UserMessageProvenanceChrome";
import {
  getTurnDisplayBlockKey,
  ScopedTranscriptBlocks,
  TurnDisplayBlockNode,
} from "@/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import {
  turnHasAssistantRenderableTranscriptContent,
  resolveVisibleOptimisticPrompt,
  shouldShowPendingPromptActivity,
} from "@/lib/domain/chat/pending-prompts";
import {
  lastTopLevelItemIsAssistantProseWithText,
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@/lib/domain/chat/transcript-trailing-status";
import {
  resolveAssistantTurnActionTime,
  resolveOptimisticPromptActionTime,
  resolveUserMessageActionTime,
} from "@/lib/domain/chat/transcript-action-time";
import type {
  FileChangeContentPart,
  FileReadContentPart,
  PendingPromptEntry,
  TranscriptState,
  ToolCallContentPart,
  ToolCallItem,
  ToolResultTextContentPart,
  TranscriptItem,
  TurnRecord,
  TerminalOutputContentPart,
} from "@anyharness/sdk";
import type { SessionViewState } from "@/lib/domain/sessions/activity";

const TURN_HORIZONTAL_PADDING = "px-0";
const ASSISTANT_ACTION_SLOT_HEIGHT = "h-6";
const EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS = new Set<string>();
const ProposedPlanToolCallIdsContext = createContext<Set<string>>(
  EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS,
);
const TranscriptSessionIdContext = createContext<string | null>(null);
const TranscriptOpenSessionContext = createContext<((sessionId: string) => void) | null>(null);
type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

/**
 * Minimum height for a turn that has no assistant text yet. Once prose exists,
 * the trailing status should stay compact instead of creating an empty block
 * between the prose and future tool activity.
 */
const TRAILING_STATUS_MIN_HEIGHT = "min-h-[2.625rem]";
const LIVE_STATUS_GRACE_MS = 700;

interface MessageListProps {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  optimisticPrompt: PendingPromptEntry | null;
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
  bottomInsetPx?: number;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
  onOpenSession?: (sessionId: string) => void;
}

export function MessageList({
  activeSessionId,
  selectedWorkspaceId,
  optimisticPrompt,
  transcript,
  sessionViewState,
  bottomInsetPx = CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  onHandOffPlanToNewSession,
  onOpenSession,
}: MessageListProps) {
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
  const { openFileDiff } = useWorkspaceFileActions();
  const { openArtifact } = useOpenCoworkArtifact();
  const subagentBrailleColors = useMemo(
    () => buildSubagentBrailleColorMap(transcript),
    [transcript],
  );
  const toolCallIdsWithProposedPlan = useMemo(
    () => collectToolCallIdsWithProposedPlan(transcript),
    [transcript.itemsById],
  );

  const totalItems = transcript.turnOrder.reduce(
    (sum, tid) => sum + (transcript.turnsById[tid]?.itemOrder.length ?? 0),
    0,
  );
  const latestTurnHasAssistantRenderableContent = turnHasAssistantRenderableTranscriptContent(
    latestTurn,
    transcript,
  );
  const visibleOptimisticPrompt = resolveVisibleOptimisticPrompt({
    optimisticPrompt,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnHasAssistantRenderableContent,
  });
  const optimisticPromptTrailingStatus = visibleOptimisticPrompt
    && shouldShowPendingPromptActivity({
      optimisticPrompt: visibleOptimisticPrompt,
      sessionViewState,
    })
    ? resolvePendingPromptTrailingStatus(
      visibleOptimisticPrompt.queuedAt,
      sessionViewState,
      true,
    )
    : null;
  const visibleTurnIds = useMemo(() => transcript.turnOrder.filter((turnId) => {
    const turn = transcript.turnsById[turnId];
    if (!turn) return false;

    const isLatestTurn = turnId === latestTurnId;
    const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
    return !(
      visibleOptimisticPrompt !== null
      && isLatestTurnInProgress
      && !latestTurnHasAssistantRenderableContent
    );
  }), [
    latestTurnHasAssistantRenderableContent,
    latestTurnId,
    transcript.turnOrder,
    transcript.turnsById,
    visibleOptimisticPrompt,
  ]);
  const latestTurnInProgress = !!latestTurn && !latestTurn.completedAt;
  const latestTurnPresentation = useMemo(
    () => latestTurn ? buildTurnPresentation(latestTurn, transcript) : null,
    [latestTurn, transcript],
  );
  const latestLiveExplorationBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveExplorationBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestLiveWorkBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveWorkBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestTransientText = latestTurn
    ? latestTransientStatusText(latestTurn, transcript)
    : null;
  const shouldShowDelayedLatestLiveStatus = !!latestTurn
    && latestTurnInProgress
    && !latestLiveWorkBlock
    && sessionViewState === "working"
    && shouldAllowTurnTrailingStatus({
      turn: latestTurn,
      transcript,
      isLatestTurnInProgress: true,
    });
  const [showDelayedLatestLiveStatus, setShowDelayedLatestLiveStatus] = useState(false);

  useEffect(() => {
    if (!shouldShowDelayedLatestLiveStatus) {
      setShowDelayedLatestLiveStatus(false);
      return;
    }

    setShowDelayedLatestLiveStatus(false);
    const timeout = window.setTimeout(() => {
      setShowDelayedLatestLiveStatus(true);
    }, LIVE_STATUS_GRACE_MS);
    return () => window.clearTimeout(timeout);
  }, [
    latestTransientText,
    latestTurn?.itemOrder.length,
    latestTurn?.startedAt,
    latestTurnId,
    shouldShowDelayedLatestLiveStatus,
  ]);

  const latestLiveStatus = latestTurn
    && showDelayedLatestLiveStatus
      ? resolveTurnTrailingStatus(
          latestTurn.startedAt,
          sessionViewState,
          latestTransientText,
        )
      : null;
  const { scrollRef, contentRef } = useMessageListScroll({
    bottomInsetPx,
    totalItems,
    pendingPromptText: visibleOptimisticPrompt?.text ?? null,
    isSessionBusy: sessionViewState === "working" || sessionViewState === "needs_input",
    selectedWorkspaceId,
    activeSessionId,
  });
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const getTranscriptCopyText = useCallback(() => buildTranscriptCopyText({
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
    proposedPlanToolCallIds: toolCallIdsWithProposedPlan,
  }), [
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
    toolCallIdsWithProposedPlan,
  ]);

  useChatTranscriptSelection({
    rootRef: selectionRootRef,
    getCopyText: getTranscriptCopyText,
  });

  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <ProposedPlanToolCallIdsContext.Provider value={toolCallIdsWithProposedPlan}>
        <TranscriptSessionIdContext.Provider value={activeSessionId}>
          <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
            <AutoHideScrollArea className="h-full" ref={scrollRef}>
              <div
                ref={contentRef}
                className={`${CHAT_SURFACE_GUTTER_CLASSNAME} pt-4`}
                style={{ paddingBottom: bottomInsetPx }}
              >
                <div
                  ref={selectionRootRef}
                  data-chat-transcript-root="true"
                  tabIndex={-1}
                  className={`${CHAT_COLUMN_CLASSNAME} select-none outline-none`}
                >
                  {visibleTurnIds.map((turnId, turnIdx) => {
                    const turn = transcript.turnsById[turnId];
                    if (!turn) return null;
                    const isLatestTurn = turnId === latestTurnId;
                    const isLatestTurnInProgress =
                      isLatestTurn && !turn.completedAt;
                    const hasFileBadges = turn.fileBadges.length > 0;
                    const presentation = isLatestTurn && latestTurnPresentation
                      ? latestTurnPresentation
                      : buildTurnPresentation(turn, transcript);
                    const liveExplorationBlock = isLatestTurn ? latestLiveExplorationBlock : null;
                    const tailAssistantProseRootId = findTailAssistantProseRootId(
                      presentation,
                      transcript,
                    );
                    const tailAssistantCopyContent = getAssistantProseContent(
                      tailAssistantProseRootId,
                      transcript,
                    );
                    const tailAssistantItem = tailAssistantProseRootId
                      ? transcript.itemsById[tailAssistantProseRootId]
                      : null;
                    const tailAssistantActionTime = resolveAssistantTurnActionTime({
                      assistantItem: tailAssistantItem?.kind === "assistant_prose" ? tailAssistantItem : null,
                      turn,
                    });
                    // Hide the trailing indicator only while the assistant prose item
                    // itself is actively streaming. If Codex closes the prose item but
                    // keeps working internally, the trailing indicator should return.
                    const trailingStatus = isLatestTurn
                      ? latestLiveStatus
                      : shouldAllowTurnTrailingStatus({
                          turn,
                          transcript,
                          isLatestTurnInProgress,
                        })
                          ? resolveTurnTrailingStatus(
                              turn.startedAt,
                              sessionViewState,
                              latestTransientStatusText(turn, transcript),
                            )
                          : null;
                    const shouldReserveTurnAssistantActionSlot =
                      isLatestTurnInProgress
                      && !!tailAssistantCopyContent
                      && !trailingStatus
                      && lastTopLevelItemIsAssistantProseWithText(turn, transcript);
                    const trailingStatusClassName = tailAssistantCopyContent
                      ? undefined
                      : TRAILING_STATUS_MIN_HEIGHT;

                    return (
                      <TurnShell key={turnId} isFirst={turnIdx === 0}>
                        <div className={`flex flex-col gap-2 ${tailAssistantCopyContent ? "group/turn" : ""}`}>
                          <TurnItemSequence
                            turn={turn}
                            transcript={transcript}
                            isTurnComplete={!!turn.completedAt}
                            presentation={presentation}
                            forceExpandedCollapsedActionBlockId={liveExplorationBlock?.blockId ?? null}
                            tailAssistantProseRootId={tailAssistantProseRootId}
                            workspaceId={selectedWorkspaceId}
                            onOpenArtifact={openArtifact}
                            subagentBrailleColors={subagentBrailleColors}
                            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                          />
                          {turn.completedAt && hasFileBadges && (
                            <TurnDiffPanel
                              turn={turn}
                              transcript={transcript}
                              onOpenFile={(filePath) => void openFileDiff(filePath)}
                            />
                          )}
                          <TurnAssistantActionRow
                            content={tailAssistantCopyContent}
                            showCopyButton={!!turn.completedAt}
                            reserveSlot={shouldReserveTurnAssistantActionSlot}
                            timestampLabel={tailAssistantActionTime}
                          />
                          {trailingStatus && (
                            <div className={trailingStatusClassName}>{trailingStatus}</div>
                          )}
                        </div>
                      </TurnShell>
                    );
                  })}
                  {visibleOptimisticPrompt && (
                    <TurnShell key="pending-prompt" isFirst={visibleTurnIds.length === 0}>
                      <div className="flex flex-col gap-2">
                        {(() => {
                          const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
                            visibleOptimisticPrompt.promptProvenance,
                            visibleOptimisticPrompt.text,
                          );
                          if (isSubagentWakeProvenance(visibleOptimisticPrompt.promptProvenance)) {
                            return (
                              <div className="flex justify-end">
                                <SubagentWakeBadge
                                  label={visibleOptimisticPrompt.promptProvenance.label ?? null}
                                  color={resolveSubagentColor(visibleOptimisticPrompt.promptProvenance.sessionLinkId)}
                                />
                              </div>
                            );
                          }
                          if (reviewFeedbackReference) {
                            return (
                              <ReviewFeedbackSummary
                                reference={reviewFeedbackReference}
                                sessionId={activeSessionId}
                                state="queued"
                                onOpenSession={onOpenSession}
                              />
                            );
                          }
                          return (
                            <UserMessage
                              sessionId={activeSessionId}
                              content={visibleOptimisticPrompt.text}
                              contentParts={visibleOptimisticPrompt.contentParts}
                              showCopyButton
                              timestampLabel={resolveOptimisticPromptActionTime(visibleOptimisticPrompt)}
                            />
                          );
                        })()}
                        {optimisticPromptTrailingStatus && (
                          <div className={TRAILING_STATUS_MIN_HEIGHT}>{optimisticPromptTrailingStatus}</div>
                        )}
                      </div>
                    </TurnShell>
                  )}
                </div>
              </div>
            </AutoHideScrollArea>
          </TranscriptOpenSessionContext.Provider>
        </TranscriptSessionIdContext.Provider>
      </ProposedPlanToolCallIdsContext.Provider>
    </div>
  );
}

function resolvePendingPromptTrailingStatus(
  queuedAt: string,
  sessionViewState: SessionViewState,
  forceWorking: boolean,
): ReactNode {
  if (sessionViewState === "needs_input") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleQuestion className="size-3.5 shrink-0 text-warning-foreground" />
        <span>Waiting for your input</span>
      </div>
    );
  }

  if (forceWorking || sessionViewState === "working") {
    return <StreamingIndicator startedAt={queuedAt} />;
  }

  return null;
}

function resolveTurnTrailingStatus(
  startedAt: string,
  sessionViewState: SessionViewState,
  transientStatusText: string | null,
): ReactNode {
  if (sessionViewState === "working" && transientStatusText) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{transientStatusText}</span>
      </div>
    );
  }

  if (sessionViewState === "working") {
    return <StreamingIndicator startedAt={startedAt} />;
  }

  if (sessionViewState === "needs_input") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleQuestion className="size-3.5 shrink-0 text-warning-foreground" />
        <span>Waiting for your input</span>
      </div>
    );
  }

  return null;
}

function findTailAssistantProseRootId(
  presentation: ReturnType<typeof buildTurnPresentation>,
  transcript: TranscriptState,
): string | null {
  for (let i = presentation.displayBlocks.length - 1; i >= 0; i--) {
    const block = presentation.displayBlocks[i];
    if (block?.kind !== "item") continue;
    const item = transcript.itemsById[block.itemId];
    if (item?.kind === "assistant_prose" && item.text) {
      return block.itemId;
    }
  }
  return null;
}

function getAssistantProseContent(
  itemId: string | null,
  transcript: TranscriptState,
): string | null {
  if (!itemId) {
    return null;
  }
  const item = transcript.itemsById[itemId];
  return item?.kind === "assistant_prose" && item.text ? item.text : null;
}

function collectToolCallIdsWithProposedPlan(
  transcript: TranscriptState,
): Set<string> {
  const toolCallIds = new Set<string>();
  for (const item of Object.values(transcript.itemsById)) {
    if (item.kind === "proposed_plan" && item.plan.sourceToolCallId) {
      toolCallIds.add(item.plan.sourceToolCallId);
    }
  }
  return toolCallIds;
}

function hasProposedPlanForToolCall(
  toolCallIdsWithProposedPlan: Set<string>,
  toolCallId: string | null,
): boolean {
  if (!toolCallId) {
    return false;
  }
  return toolCallIdsWithProposedPlan.has(toolCallId);
}

function TurnItemSequence({
  turn,
  transcript,
  isTurnComplete,
  presentation,
  forceExpandedCollapsedActionBlockId,
  tailAssistantProseRootId,
  workspaceId,
  onOpenArtifact,
  subagentBrailleColors,
  onHandOffPlanToNewSession,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  isTurnComplete: boolean;
  presentation: ReturnType<typeof buildTurnPresentation>;
  forceExpandedCollapsedActionBlockId?: string | null;
  tailAssistantProseRootId: string | null;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  const completedHistoryRootIdSet = new Set(presentation.completedHistoryRootIds);
  let hasRenderedCompletedHistory = false;

  return (
    <>
      {presentation.displayBlocks.map((block) => {
        if (presentation.completedHistorySummary && blockBelongsToCompletedHistory(block, completedHistoryRootIdSet)) {
          if (hasRenderedCompletedHistory) {
            return null;
          }
          hasRenderedCompletedHistory = true;
          return (
            <ToolCallSummary
              key={`${turn.turnId}-completed-history`}
              icon={<ClipboardList />}
              label="Work history"
              summary={formatCollapsedSummary(presentation.completedHistorySummary)}
              typeIcons={buildCollapsedSummaryIcons(presentation.completedHistorySummary)}
              showFinalSeparator={tailAssistantProseRootId !== null}
            >
              <div className="space-y-1">
                {presentation.displayBlocks
                  .filter((historyBlock) =>
                    blockBelongsToCompletedHistory(historyBlock, completedHistoryRootIdSet)
                  )
                  .map((historyBlock) => (
                    <TurnDisplayBlockNode
                      key={`history-${getTurnDisplayBlockKey(historyBlock)}`}
                      block={historyBlock}
                      transcript={transcript}
                      forceExpandedCollapsedActionBlockId={null}
                      renderItem={(itemId) => (
                        <FragmentWithArtifacts
                          itemId={itemId}
                          transcript={transcript}
                          childrenByParentId={presentation.childrenByParentId}
                          subagentBrailleColors={subagentBrailleColors}
                          artifactToolCalls={null}
                          workspaceId={workspaceId}
                          onOpenArtifact={onOpenArtifact}
                          onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                        />
                      )}
                    />
                  ))}
              </div>
            </ToolCallSummary>
          );
        }

        return (
          <TurnDisplayBlockNode
            key={getTurnDisplayBlockKey(block)}
            block={block}
            transcript={transcript}
            forceExpandedCollapsedActionBlockId={forceExpandedCollapsedActionBlockId}
            renderItem={(itemId) => (
              <FragmentWithArtifacts
                itemId={itemId}
                transcript={transcript}
                childrenByParentId={presentation.childrenByParentId}
                subagentBrailleColors={subagentBrailleColors}
                artifactToolCalls={
                  itemId === tailAssistantProseRootId ? completedArtifactToolCalls : null
                }
                workspaceId={workspaceId}
                onOpenArtifact={onOpenArtifact}
                onHandOffPlanToNewSession={onHandOffPlanToNewSession}
              />
            )}
          />
        );
      })}
      {tailAssistantProseRootId === null && completedArtifactToolCalls.length > 0 && (
        <div className="space-y-1.5">
          {completedArtifactToolCalls.map((item) => (
            <CoworkArtifactTurnCard
              key={`turn-artifact-${item.itemId}`}
              item={item}
              onOpenArtifact={
                workspaceId ? (artifactId) => onOpenArtifact(workspaceId, artifactId) : undefined
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

function shouldForceExpandActionBlock(
  itemIds: readonly string[],
  transcript: TranscriptState,
  isTurnComplete: boolean,
): boolean {
  if (isTurnComplete) {
    return false;
  }

  const summary = summarizeCollapsedActions(itemIds, transcript);
  return summary.reads > 0
    || summary.listings > 0
    || summary.searches > 0
    || summary.fetches > 0;
}

function findTrailingLiveExplorationBlock(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  isInProgress: boolean,
): Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null {
  if (!isInProgress) {
    return null;
  }

  const block = displayBlocks[displayBlocks.length - 1];
  if (block?.kind !== "collapsed_actions") {
    return null;
  }

  return shouldForceExpandActionBlock(block.itemIds, transcript, false)
    ? block
    : null;
}

function findTrailingLiveWorkBlock(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  isLatestTurnInProgress: boolean,
): TurnDisplayBlock | null {
  if (!isLatestTurnInProgress) {
    return null;
  }

  for (let index = displayBlocks.length - 1; index >= 0; index--) {
    const block = displayBlocks[index];
    if (blockContainsActiveToolWork(block, transcript)) {
      return block;
    }
  }

  return null;
}

function blockContainsActiveToolWork(
  block: TurnDisplayBlock | undefined,
  transcript: TranscriptState,
): boolean {
  if (!block) {
    return false;
  }

  if (block.kind === "collapsed_actions") {
    return block.itemIds.some((itemId) => isActiveToolItem(transcript.itemsById[itemId]));
  }

  return isActiveToolItem(transcript.itemsById[block.itemId]);
}

function isActiveToolItem(item: TranscriptItem | undefined): boolean {
  return item?.kind === "tool_call"
    && item.status !== "completed"
    && item.status !== "failed";
}

function blockBelongsToCompletedHistory(
  block: TurnDisplayBlock,
  completedHistoryRootIds: Set<string>,
): boolean {
  if (block.kind === "collapsed_actions") {
    return block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}

function FragmentWithArtifacts({
  itemId,
  transcript,
  childrenByParentId,
  subagentBrailleColors,
  artifactToolCalls,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  subagentBrailleColors: Map<string, string>;
  artifactToolCalls: ToolCallItem[] | null;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  return (
    <>
      <TranscriptTreeNode
        itemId={itemId}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        subagentBrailleColors={subagentBrailleColors}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
      {artifactToolCalls && artifactToolCalls.length > 0 && (
        <div className="space-y-1.5">
          {artifactToolCalls.map((item) => (
            <CoworkArtifactTurnCard
              key={`artifact-inline-${item.itemId}`}
              item={item}
              onOpenArtifact={
                workspaceId ? (artifactId) => onOpenArtifact(workspaceId, artifactId) : undefined
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

function TurnShell({
  children,
  isFirst = false,
}: {
  children: ReactNode;
  isFirst?: boolean;
}) {
  return (
    <div className={`${TURN_HORIZONTAL_PADDING} w-full max-w-full ${isFirst ? "pt-0" : "pt-2"} pb-2`}>
      {children}
    </div>
  );
}

function TranscriptItemBlock({
  item,
  transcript,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  item: TranscriptItem;
  transcript: TranscriptState;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const toolCallIdsWithProposedPlan = useContext(ProposedPlanToolCallIdsContext);
  const sessionId = useContext(TranscriptSessionIdContext);
  const openSession = useContext(TranscriptOpenSessionContext);
  const sessionSlots = useHarnessStore((s) => s.sessionSlots);

  switch (item.kind) {
    case "user_message": {
      if (isSubagentWakeProvenance(item.promptProvenance)) {
        const completion =
          transcript.linkCompletionsByCompletionId[item.promptProvenance.completionId] ?? null;
        const childAgentKind = completion?.childSessionId
          ? sessionSlots[completion.childSessionId]?.agentKind ?? null
          : null;
        return (
          <div className="flex justify-end">
            <SubagentWakeBadge
              label={item.promptProvenance.label ?? completion?.label ?? null}
              childSessionId={completion?.childSessionId ?? null}
              outcome={completion?.outcome ?? null}
              color={resolveSubagentColor(item.promptProvenance.sessionLinkId)}
              agentKind={childAgentKind}
              titleFallback={
                item.promptProvenance.type === "linkWake"
                && item.promptProvenance.relation === "cowork_coding_session"
                  ? "Coding session"
                  : "Subagent"
              }
              onOpenChild={openSession ?? undefined}
            />
          </div>
        );
      }

      const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
        item.promptProvenance,
        item.text,
      );
      if (reviewFeedbackReference) {
        return (
          <ReviewFeedbackSummary
            reference={reviewFeedbackReference}
            sessionId={sessionId}
            onOpenSession={openSession ?? undefined}
          />
        );
      }

      if (isAgentSessionProvenance(item.promptProvenance)) {
        return (
          <UserMessage
            sessionId={sessionId}
            content={item.text}
            contentParts={item.contentParts}
            showCopyButton
            timestampLabel={resolveUserMessageActionTime(item)}
            footer={(
              <UserMessageProvenanceChrome
                sourceSessionId={item.promptProvenance.sourceSessionId}
                label={item.promptProvenance.label ?? null}
                color={resolveSubagentColor(item.promptProvenance.sessionLinkId ?? item.promptProvenance.sourceSessionId)}
                onOpenParent={openSession ?? undefined}
              />
            )}
          />
        );
      }

      return (
        <UserMessage
          sessionId={sessionId}
          content={item.text}
          contentParts={item.contentParts}
          showCopyButton
          timestampLabel={resolveUserMessageActionTime(item)}
        />
      );
    }

    case "assistant_prose": {
      if (!item.text) return null;

      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full min-w-0 max-w-full break-words">
            <AssistantMessage
              content={item.text}
              isStreaming={item.isStreaming}
            />
          </div>
        </div>
      );
    }

    case "thought":
      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-xl lg:max-w-3xl space-y-1 break-words">
            <ReasoningBlock content={item.text || undefined} />
          </div>
        </div>
      );

    case "tool_call": {
      if (isClaudeExitPlanModeCall(item)) {
        if (hasProposedPlanForToolCall(toolCallIdsWithProposedPlan, item.toolCallId)) {
          return null;
        }
        const body = extractClaudePlanBody(item) ?? "";
        return (
          <div className="flex justify-start relative">
            <div className="flex flex-col w-full max-w-xl lg:max-w-3xl space-y-1 break-words">
              <ClaudePlanCard
                content={body}
                isStreaming={item.status === "in_progress"}
              />
            </div>
          </div>
        );
      }
      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-xl lg:max-w-3xl space-y-1 break-words">
            <ToolCallItemBlock
              item={item}
              workspaceId={workspaceId}
              onOpenArtifact={onOpenArtifact}
            />
          </div>
        </div>
      );
    }

    case "plan":
      // Structured plan items (Codex/Gemini todos) render as the
      // TodoTrackerPanel above the composer, not inline in the transcript.
      return null;

    case "proposed_plan": {
      return (
        <ConnectedProposedPlanItem
          item={item}
          onHandOffToNewSession={onHandOffPlanToNewSession ?? undefined}
        />
      );
    }

    case "error":
      return (
        <SessionErrorItem item={item} sessionId={sessionId} />
      );

    case "unknown":
      return (
        <SystemMessage content={`Unknown event: ${item.eventType}`} />
      );

    default:
      return null;
  }
}

function TranscriptTreeNode({
  itemId,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  subagentBrailleColors,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const item = transcript.itemsById[itemId];
  if (!item) return null;

  const childIds = childrenByParentId.get(itemId) ?? [];
  if (item.kind === "tool_call" && (childIds.length > 0 || isSubagentItem(item))) {
    return (
      <ToolCallGroupBlock
        item={item}
        childIds={childIds}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        subagentBrailleColors={subagentBrailleColors}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
    );
  }

  return (
    <TranscriptItemBlock
      item={item}
      transcript={transcript}
      workspaceId={workspaceId}
      onOpenArtifact={onOpenArtifact}
      onHandOffPlanToNewSession={onHandOffPlanToNewSession}
    />
  );
}

function TurnAssistantActionRow({
  content,
  showCopyButton = false,
  reserveSlot = false,
  timestampLabel = null,
}: {
  content: string | null;
  showCopyButton?: boolean;
  reserveSlot?: boolean;
  timestampLabel?: string | null;
}) {
  if (!content || (!showCopyButton && !reserveSlot)) {
    return null;
  }

  return (
    <div className="flex justify-start relative">
      <div className={`pl-1 pt-0.5 ${ASSISTANT_ACTION_SLOT_HEIGHT}`}>
        {showCopyButton && (
          <CopyMessageButton
            content={content}
            timestampLabel={timestampLabel}
            visibilityClassName="opacity-0 group-hover/turn:opacity-100"
          />
        )}
      </div>
    </div>
  );
}

function ToolCallItemBlock({
  item,
  workspaceId,
  onOpenArtifact,
}: {
  item: ToolCallItem;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
}) {
  const openCodingSession = useOpenCoworkCodingSession();
  const { selectWorkspace } = useWorkspaceSelection();

  if (
    item.semanticKind === "cowork_artifact_create"
    || item.semanticKind === "cowork_artifact_update"
  ) {
    return (
      <CoworkArtifactToolActionRow
        item={item}
        onOpenArtifact={
          workspaceId
            ? (artifactId) => onOpenArtifact(workspaceId, artifactId)
            : undefined
        }
      />
    );
  }

  if (item.semanticKind === "cowork_coding") {
    return (
      <CoworkCodingToolActionRow
        item={item}
        onOpenCodingSession={(input) => { void openCodingSession(input); }}
        onOpenWorkspace={(targetWorkspaceId) => {
          void selectWorkspace(targetWorkspaceId, { force: true });
        }}
      />
    );
  }

  const fileChanges = item.contentParts.filter(
    (part): part is FileChangeContentPart => part.type === "file_change",
  );
  const fileReads = item.contentParts.filter(
    (part): part is FileReadContentPart => part.type === "file_read",
  );
  const terminalParts = item.contentParts.filter(
    (part): part is TerminalOutputContentPart => part.type === "terminal_output",
  );
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  const normalizedResultText = normalizeToolResultText(toolResultText);
  const toolName = toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "Tool call";
  const rawInput = isRecord(item.rawInput);
  const bashDescription = readString(rawInput?.description) ?? undefined;
  const bashCommand = readString(rawInput?.command) ?? toolName;
  const fallbackDisplay = describeToolCallDisplay(item, toolName);
  const rows: React.ReactNode[] = [];
  const status = mapStatus(item.status);

  fileChanges.forEach((part, idx) => {
    rows.push(
      <FileChangeCall
        key={`file-change-${idx}`}
        operation={part.operation}
        path={part.path}
        workspacePath={part.workspacePath}
        basename={part.basename}
        newPath={part.newPath}
        newWorkspacePath={part.newWorkspacePath}
        newBasename={part.newBasename}
        additions={part.additions}
        deletions={part.deletions}
        patch={part.patch}
        preview={part.preview}
        status={status}
      />,
    );
  });

  fileReads.forEach((part, idx) => {
    rows.push(
      <FileReadCall
        key={`file-read-${idx}`}
        path={part.path}
        workspacePath={part.workspacePath}
        basename={part.basename}
        line={part.line}
        scope={part.scope}
        startLine={part.startLine}
        endLine={part.endLine}
        preview={part.preview ?? (normalizedResultText || undefined)}
        status={status}
      />,
    );
  });

  if (terminalParts.length > 0) {
    const output = terminalParts
      .filter((part) => part.event === "output" && part.data)
      .map((part) => part.data ?? "")
      .join("");
    rows.push(
      <BashCommandCall
        key="terminal"
        command={bashCommand}
        description={bashDescription}
        output={output || (typeof item.rawOutput === "string" ? item.rawOutput : undefined)}
        status={status}
        duration={formatToolDuration(item)}
      />,
    );
  }

  if (rows.length === 0 && normalizedResultText) {
    if (item.nativeToolName === "Bash" || item.toolKind === "execute") {
      rows.push(
        <BashCommandCall
          key="terminal-result"
          command={bashCommand}
          description={bashDescription}
          output={normalizedResultText}
          status={status}
          duration={formatToolDuration(item)}
        />,
      );
    } else if (item.nativeToolName === "Read" || item.toolKind === "read") {
      const fallbackReadPath = deriveReadPath(item, toolName);
      rows.push(
        <FileReadCall
          key="read-result"
          path={fallbackReadPath}
          basename={fallbackReadPath.split("/").pop() ?? fallbackReadPath}
          scope="unknown"
          preview={normalizedResultText}
          status={status}
        />,
      );
    }
  }

  if (rows.length === 0 && normalizedResultText) {
    rows.push(
      <GenericToolResultRow
        key="result"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        label={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
        status={status}
        hint={fallbackDisplay.hint}
        resultText={normalizedResultText}
      />,
    );
  }

  if (rows.length === 0) {
    rows.push(
      <GenericToolResultRow
        key="tool"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        label={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
        status={status}
        hint={fallbackDisplay.hint}
      />,
    );
  }

  return rows.length === 1 ? <>{rows[0]}</> : <div className="space-y-1.5">{rows}</div>;
}

function ToolCallGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  subagentBrailleColors,
  onHandOffPlanToNewSession,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const isAgent = isSubagentItem(item);

  if (isAgent) {
    return (
      <AgentGroupBlock
        item={item}
        childIds={childIds}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        subagentBrailleColors={subagentBrailleColors}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
    );
  }

  const descendants = collectDescendantItems(childIds, transcript, childrenByParentId);
  const subagentCount = descendants.filter(
    (entry) => entry.kind === "tool_call" && entry.semanticKind === "subagent",
  ).length;
  const toolCallCount = descendants.filter(
    (entry) => entry.kind === "tool_call" && entry.semanticKind !== "subagent",
  ).length;
  const messageCount = descendants.filter(
    (entry) => entry.kind === "assistant_prose" || entry.kind === "thought",
  ).length;
  const summary = formatCollapsedSummary({
    messages: messageCount,
    toolCalls: toolCallCount,
    subagents: subagentCount,
  });
  const renderableItemCount = (hasRenderableToolDetails(item) ? 1 : 0) + childIds.length;
  const display = describeToolCallDisplay(
    item,
    item.title ?? item.nativeToolName ?? "Tool group",
  );

  return (
    <ToolCallSummary
      icon={<ToolKindIcon iconKey={display.iconKey} />}
      label={display.label}
      summary={summary}
      defaultExpanded={item.status === "in_progress"}
      itemCount={renderableItemCount}
      typeIcons={buildCollapsedSummaryIcons({
        messages: messageCount,
        toolCalls: toolCallCount,
        subagents: subagentCount,
      })}
    >
      <div className="space-y-1.5">
        {hasRenderableToolDetails(item) && (
          <ToolCallItemBlock
            item={item}
            workspaceId={workspaceId}
            onOpenArtifact={onOpenArtifact}
          />
        )}
        <div className="ml-1 space-y-1.5">
          {childIds.map((childId) => (
            <TranscriptTreeNode
              key={childId}
              itemId={childId}
              transcript={transcript}
              childrenByParentId={childrenByParentId}
              workspaceId={workspaceId}
              onOpenArtifact={onOpenArtifact}
              subagentBrailleColors={subagentBrailleColors}
              onHandOffPlanToNewSession={onHandOffPlanToNewSession}
            />
          ))}
        </div>
      </div>
    </ToolCallSummary>
  );
}

function AgentGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  subagentBrailleColors,
  onHandOffPlanToNewSession,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const executionState = resolveSubagentExecutionState(item);
  const asyncLaunch = parseAsyncSubagentLaunch(item);
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  const launchResult = parseSubagentLaunchResult(item);
  const brailleColor = launchResult?.sessionLinkId
    ? resolveSubagentColor(launchResult.sessionLinkId)
    : resolveSubagentBrailleColor(subagentBrailleColors, item);
  const openSession = useContext(TranscriptOpenSessionContext);
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

  // Agent synthesis lives in the agent item's own tool_result_text content parts
  const agentResultText = item.contentParts
    .filter((p): p is ToolResultTextContentPart => p.type === "tool_result_text")
    .map((p) => p.text)
    .join("\n\n");
  const normalizedAgentResult = provisioningStatus
    ? ""
    : normalizeToolResultText(agentResultText);

  // Count internal work
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

  const description = subagentDisplay.title;
  const hasWork = childIds.length > 0;
  const hasLaunchLedger = !!normalizedPrompt || !!provisioningStatus;
  const hasBodyContent = hasWork || hasLaunchLedger || !!normalizedAgentResult;
  const renderScopedWork = (
    forceExpandedCollapsedActionBlockId: string | null,
  ) => (
    <ScopedTranscriptBlocks
      displayBlocks={scopedDisplayBlocks}
      transcript={transcript}
      forceExpandedCollapsedActionBlockId={forceExpandedCollapsedActionBlockId}
      renderItem={(childId) => (
        <TranscriptTreeNode
          itemId={childId}
          transcript={transcript}
          childrenByParentId={childrenByParentId}
          workspaceId={workspaceId}
          onOpenArtifact={onOpenArtifact}
          subagentBrailleColors={subagentBrailleColors}
          onHandOffPlanToNewSession={onHandOffPlanToNewSession}
        />
      )}
    />
  );
  const headerVerb = executionState === "failed"
    ? "Subagent launch failed"
    : isRunning
      ? "Creating subagent"
      : "Created subagent";
  const headerIcon = isRunning || executionState === "expired_background"
    ? <AgentHeaderIcon state={executionState} color={brailleColor} />
    : null;
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
      {/* Agent header — clickable to collapse/expand */}
      <div
        {...(headerExpandable ? { "data-chat-transcript-ignore": true } : {})}
        onClick={() => headerExpandable && setExpanded(!expanded)}
        className={`group/tool-action-row inline-flex items-center gap-1 rounded-md pl-0.5 pr-1.5 py-1 text-chat leading-[var(--text-chat--line-height)] transition-colors ${
          headerExpandable
            ? "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            : "cursor-default text-muted-foreground"
        }`}
      >
        {headerIcon && (
          <ToolActionLeadingAffordance
            icon={headerIcon}
            expandable={headerExpandable}
            expanded={expanded}
          />
        )}
        <span className="font-[460] text-foreground/90">{headerVerb}</span>
        <span className="min-w-0 truncate text-foreground/90">{description}</span>
        {subagentDisplay.meta && (
          <span className="ml-1 text-sm text-muted-foreground">{subagentDisplay.meta}</span>
        )}
        {!expanded && collapsedSummary && (
          <span className="ml-1 text-sm text-muted-foreground">
            {subagentDisplay.meta ? `· ${collapsedSummary}` : collapsedSummary}
          </span>
        )}
      </div>

      {/* Agent body — indented with left border */}
      {expanded && hasBodyContent && <div className="ml-1 border-l border-border/70 pl-2">
        {hasLaunchLedger && (
          <SubagentLaunchLedger
            prompt={normalizedPrompt || null}
            provisioningStatus={provisioningStatus}
            executionState={executionState}
            childSessionId={launchResult?.childSessionId ?? null}
            onOpenChild={openSession ?? undefined}
          />
        )}

        {/* Internal work — collapsed when complete */}
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

        {/* Agent's synthesis / result */}
        {normalizedAgentResult && (
          asyncLaunch
            ? <AsyncAgentLaunchBlock launch={asyncLaunch} color={brailleColor} />
            : <AgentResultBlock content={normalizedAgentResult} />
        )}
      </div>}
    </div>
  );
}


const AGENT_RESULT_COLLAPSED_HEIGHT = 200;

function AgentHeaderIcon({
  state,
  color,
}: {
  state: SubagentExecutionState;
  color?: string;
}) {
  return state === "running" || state === "background"
    ? <AgentHeaderRunningIcon color={color} />
    : state === "expired_background"
      ? <CircleQuestion className="size-4 text-muted-foreground" />
    : <Sparkles />;
}

function AgentHeaderRunningIcon({ color }: { color?: string }) {
  const frame = useBrailleFillsweep();
  return (
    <span
      className="inline-block w-[1em] shrink-0 font-mono leading-none tracking-[-0.18em] opacity-80"
      style={color ? { color } : undefined}
    >
      {frame}
    </span>
  );
}

function AsyncAgentLaunchBlock({
  launch,
  color,
}: {
  launch: { rawText: string; agentId: string | null; outputFile: string | null };
  color?: string;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const hasLaunchDetails = !!launch.agentId || !!launch.outputFile;

  return (
    <div className="mt-1 rounded-md border border-border/60 bg-muted/25 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
        <AgentHeaderRunningIcon color={color} />
        <span>Running in background</span>
      </div>
      <p className="mt-1 text-sm leading-[var(--text-sm--line-height)] text-muted-foreground">
        Async subagent launched successfully. You&apos;ll be notified automatically when it completes.
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
        style={!resultExpanded && needsTruncation ? { maxHeight: AGENT_RESULT_COLLAPSED_HEIGHT } : undefined}
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

function collectDescendantItems(
  itemIds: string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const itemId of itemIds) {
    const item = transcript.itemsById[itemId];
    if (!item) continue;
    out.push(item);
    const childIds = childrenByParentId.get(itemId) ?? [];
    out.push(...collectDescendantItems(childIds, transcript, childrenByParentId));
  }
  return out;
}

function hasRenderableToolDetails(item: ToolCallItem): boolean {
  return item.contentParts.some((part) => part.type !== "tool_call");
}

function formatCollapsedSummary(summary: {
  messages: number;
  toolCalls: number;
  subagents: number;
}): string {
  return [
    pluralize(summary.messages, "message"),
    pluralize(summary.toolCalls, "tool call"),
    pluralize(summary.subagents, "subagent"),
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
}

function pluralize(count: number, singular: string, plural?: string): string | null {
  if (count <= 0) {
    return null;
  }
  return `${count} ${count === 1 ? singular : (plural ?? singular + "s")}`;
}

function buildCollapsedSummaryIcons(summary: {
  messages: number;
  toolCalls: number;
  subagents: number;
}): ReactNode[] {
  const icons: ReactNode[] = [];
  if (summary.messages > 0) {
    icons.push(<FileText key="messages" className="size-3.5" />);
  }
  if (summary.toolCalls > 0) {
    icons.push(<Settings key="tools" className="size-3.5" />);
  }
  if (summary.subagents > 0) {
    icons.push(<ClipboardList key="subagents" className="size-3.5" />);
  }
  return icons;
}

function isSubagentItem(item: ToolCallItem): boolean {
  return item.nativeToolName === "Agent" || item.semanticKind === "subagent";
}

function deriveReadPath(item: ToolCallItem, fallback: string): string {
  const rawInput = isRecord(item.rawInput);
  const fromInput =
    readString(rawInput?.file_path) ??
    readString(rawInput?.path);
  if (fromInput) return fromInput;
  return fallback.startsWith("Read ") ? fallback.slice(5) : fallback;
}

function isRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapStatus(
  status: string,
): "running" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function formatToolDuration(item: ToolCallItem): string | undefined {
  const rawItem = isRecord(item);
  const startedAtValue =
    readString(rawItem?.startedAt)
    ?? readString(rawItem?.timestamp);
  if (!startedAtValue) {
    return undefined;
  }

  const startedAt = Date.parse(startedAtValue);
  if (!Number.isFinite(startedAt)) {
    return undefined;
  }

  const completedAtValue = readString(rawItem?.completedAt);
  const completedAt = completedAtValue ? Date.parse(completedAtValue) : Date.now();
  if (!Number.isFinite(completedAt) || completedAt < startedAt) {
    return undefined;
  }

  const elapsedSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  if (elapsedSeconds < 60) {
    return `for ${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds === 0 ? `for ${minutes}m` : `for ${minutes}m ${seconds}s`;
}

function ToolKindIcon({ iconKey }: { iconKey: ToolDisplayIconKey }) {
  const className = "size-3 text-faint";

  switch (iconKey) {
    case "terminal":
      return <Terminal className={className} />;
    case "folder-list":
      return <FolderList className={className} />;
    case "file-text":
      return <FileText className={className} />;
    case "file-plus":
      return <FilePlus className={className} />;
    case "file-pen":
      return <FilePen className={className} />;
    case "clipboard-list":
      return <ClipboardList className={className} />;
    case "proliferate":
      return <ProliferateIcon className={className} />;
    case "settings":
    default:
      return <Settings className={className} />;
  }
}
