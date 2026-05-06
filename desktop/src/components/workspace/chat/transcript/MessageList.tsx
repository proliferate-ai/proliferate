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
import { SystemMessage } from "./SystemMessage";
import { UserMessage } from "./UserMessage";
import { TurnSeparator } from "./TurnSeparator";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import { GenericToolResultRow } from "@/components/workspace/chat/tool-calls/GenericToolResultRow";
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
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  FolderList,
  ProliferateIcon,
  Settings,
  Terminal,
} from "@/components/ui/icons";
import { CHAT_SCROLL_BASE_BOTTOM_PADDING_PX } from "@/config/chat-layout";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useOpenCoworkArtifact } from "@/hooks/cowork/use-open-cowork-artifact";
import { useOpenCoworkCodingSession } from "@/hooks/cowork/use-open-cowork-coding-session";
import { useChatTranscriptSelection } from "@/hooks/chat/use-chat-transcript-selection";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
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
} from "@/lib/domain/chat/subagent-launch";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
import {
  isAgentSessionProvenance,
  resolveReviewFeedbackPromptReference,
  isSubagentWakeProvenance,
} from "@/lib/domain/chat/subagents/provenance";
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
  outboxEntryToPendingPromptEntry,
  renderableOutboxEntriesForTranscript,
  type PromptOutboxEntry,
} from "@/lib/domain/chat/prompt-outbox";
import {
  type TranscriptVirtualRow,
} from "@/lib/domain/chat/transcript-virtual-rows";
import { useTranscriptRowModel } from "@/hooks/chat/use-transcript-row-model";
import { usePromptOutboxActions } from "@/hooks/chat/use-prompt-outbox-actions";
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
import type { TranscriptOpenSessionRole } from "@/lib/domain/chat/transcript-open-target";
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
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import { VirtualTranscriptRowList } from "@/components/workspace/chat/transcript/VirtualTranscriptRowList";
import {
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
  TRAILING_STATUS_MIN_HEIGHT,
  TurnAssistantActionRow,
  TurnShell,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";

const EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS = new Set<string>();
const ProposedPlanToolCallIdsContext = createContext<ReadonlySet<string>>(
  EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS,
);
const TranscriptSessionIdContext = createContext<string | null>(null);
type TranscriptOpenSessionHandler = (
  sessionId: string,
  role?: TranscriptOpenSessionRole,
) => void;
const TranscriptOpenSessionContext = createContext<TranscriptOpenSessionHandler | null>(null);
const TranscriptCanOpenSessionContext = createContext<
  ((sessionId: string, role?: TranscriptOpenSessionRole) => boolean) | null
>(null);
const noop = () => {};
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;
interface OutboxActionHandlers {
  retryPrompt: (clientPromptId: string) => void;
  dismissPrompt: (clientPromptId: string) => void;
}

const LIVE_STATUS_GRACE_MS = 700;
const OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS = 15_000;

interface MessageListProps {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  optimisticPrompt: PendingPromptEntry | null;
  outboxEntries?: readonly PromptOutboxEntry[];
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  olderHistoryCursor?: number | null;
  bottomInsetPx?: number;
  onLoadOlderHistory?: () => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
  onOpenSession?: TranscriptOpenSessionHandler;
  canOpenSession?: (sessionId: string, role?: TranscriptOpenSessionRole) => boolean;
}

export function MessageList({
  activeSessionId,
  selectedWorkspaceId,
  optimisticPrompt,
  outboxEntries = EMPTY_OUTBOX_ENTRIES,
  transcript,
  sessionViewState,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  olderHistoryCursor = null,
  bottomInsetPx = CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  onLoadOlderHistory,
  onHandOffPlanToNewSession,
  onOpenSession,
  canOpenSession,
}: MessageListProps) {
  useDebugRenderCount("transcript-list");
  const scrollSampleOperationRef = useRef<MeasurementOperationId | null>(null);
  const {
    retryPrompt,
    dismissPrompt,
  } = usePromptOutboxActions();
  const outboxActions = useMemo(() => ({
    retryPrompt,
    dismissPrompt,
  }), [retryPrompt, dismissPrompt]);
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
  const { openFileDiff } = useWorkspaceFileActions();
  const { openArtifact } = useOpenCoworkArtifact();
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
  const visibleOutboxEntries = useMemo(
    () => renderableOutboxEntriesForTranscript(outboxEntries, transcript),
    [outboxEntries, transcript],
  );
  const outboxStartedAtByPromptId = useMemo(
    () => buildOutboxStartedAtByPromptId(outboxEntries),
    [outboxEntries],
  );
  const virtualRows = useTranscriptRowModel({
    activeSessionId,
    transcript,
    visibleOptimisticPrompt,
    visibleOutboxEntries,
    latestTurnId,
    latestTurnHasAssistantRenderableContent,
  });
  const visibleTurnIds = useMemo(
    () => {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const row of virtualRows) {
        if (row.kind !== "turn" || seen.has(row.turnId)) {
          continue;
        }
        seen.add(row.turnId);
        ids.push(row.turnId);
      }
      return ids;
    },
    [virtualRows],
  );
  const latestTurnInProgress = !!latestTurn && !latestTurn.completedAt;
  const latestTurnPresentation = useMemo(
    () => {
      if (!latestTurnId) {
        return null;
      }
      const latestRow = virtualRows.find((row) =>
        row.kind === "turn" && row.turnId === latestTurnId
      );
      return latestRow?.kind === "turn" ? latestRow.presentation : null;
    },
    [latestTurnId, virtualRows],
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
  const latestTurnTiming = latestTurn
    ? resolveTurnPromptTiming(latestTurn, transcript, outboxStartedAtByPromptId)
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
  const shouldShowImmediateOutboxLiveStatus =
    shouldShowDelayedLatestLiveStatus
    && latestTurnTiming?.isOutboxStartedAt === true;
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
    latestTurnTiming?.startedAt,
    latestTurnId,
    shouldShowDelayedLatestLiveStatus,
  ]);

  const latestLiveStatus = latestTurn
    && (showDelayedLatestLiveStatus || shouldShowImmediateOutboxLiveStatus)
      ? resolveTurnTrailingStatus(
          latestTurnTiming?.startedAt ?? latestTurn.startedAt,
          sessionViewState,
          latestTransientText,
        )
      : null;
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const getTranscriptCopyText = useCallback(() => buildTranscriptCopyText({
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
    proposedPlanToolCallIds: collectToolCallIdsWithProposedPlan(transcript),
  }), [
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
  ]);

  useChatTranscriptSelection({
    rootRef: selectionRootRef,
    getCopyText: getTranscriptCopyText,
  });
  const handleTranscriptScroll = useCallback(() => {
    const operationId = startMeasurementOperation({
      kind: "transcript_scroll",
      sampleKey: "transcript",
      surfaces: ["transcript-list", "session-transcript-pane", "chat-surface"],
      idleTimeoutMs: 750,
      maxDurationMs: 8000,
      cooldownMs: 1500,
    });
    if (operationId) {
      scrollSampleOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [
        "transcript-list",
        "session-transcript-pane",
        "chat-surface",
      ]);
    }
  }, []);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(scrollSampleOperationRef.current, "unmount");
    scrollSampleOperationRef.current = null;
  }, []);

  const renderVirtualRow = useCallback((row: TranscriptVirtualRow, rowIndex: number) => {
    if (row.kind === "pending_prompt" || row.kind === "outbox_prompt") {
      const outboxEntry = row.kind === "outbox_prompt"
        ? visibleOutboxEntries.find((entry) => entry.clientPromptId === row.clientPromptId) ?? null
        : null;
      const prompt = row.kind === "pending_prompt"
        ? visibleOptimisticPrompt
        : outboxEntry
          ? outboxEntryToPendingPromptEntry(outboxEntry)
          : null;
      if (!visibleOptimisticPrompt) {
        if (!outboxEntry) {
          return null;
        }
      }
      if (!prompt) {
        return null;
      }
      const trailingStatus = row.kind === "pending_prompt"
        ? optimisticPromptTrailingStatus
        : <OutboxPromptTrailingStatus entry={outboxEntry} />;
      const outboxControls = outboxEntry
        ? renderOutboxPromptControls(outboxEntry, outboxActions)
        : null;
      return (
        <TurnShell isFirst={rowIndex === 0}>
          <div className="flex flex-col gap-2">
            {(() => {
              const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
                prompt.promptProvenance,
                prompt.text,
              );
              if (isSubagentWakeProvenance(prompt.promptProvenance)) {
                return (
                  <div className="flex justify-end">
                    <SubagentWakeBadge
                      label={prompt.promptProvenance.label ?? null}
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
                  />
                );
              }
              return (
                <UserMessage
                  sessionId={activeSessionId}
                  content={prompt.text}
                  contentParts={prompt.contentParts}
                  showCopyButton
                  timestampLabel={resolveOptimisticPromptActionTime(prompt)}
                />
              );
            })()}
            {trailingStatus && (
              <div className={TRAILING_STATUS_MIN_HEIGHT}>{trailingStatus}</div>
            )}
            {outboxControls}
          </div>
        </TurnShell>
      );
    }

    const turn = transcript.turnsById[row.turnId];
    if (!turn) {
      return null;
    }

    const isLatestTurn = row.turnId === latestTurnId;
    const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
    const hasFileBadges = turn.fileBadges.length > 0;
    const presentation = row.presentation;
    const renderPresentation = row.renderPresentation;
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
    const turnTiming = resolveTurnPromptTiming(
      turn,
      transcript,
      outboxStartedAtByPromptId,
    );
    const trailingStatus = !row.isLastTurnRow
      ? null
      : isLatestTurn
      ? latestLiveStatus
      : shouldAllowTurnTrailingStatus({
          turn,
          transcript,
          isLatestTurnInProgress,
        })
          ? resolveTurnTrailingStatus(
              turnTiming.startedAt,
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
      <TurnShell isFirst={rowIndex === 0}>
        <div className={`flex flex-col gap-2 ${tailAssistantCopyContent ? "group/turn" : ""}`}>
          <TurnItemSequence
            turn={turn}
            transcript={transcript}
            isTurnComplete={!!turn.completedAt}
            presentation={renderPresentation}
            forceExpandedCollapsedActionBlockId={liveExplorationBlock?.blockId ?? null}
            tailAssistantProseRootId={tailAssistantProseRootId}
            showCompletedArtifactFallback={row.isLastTurnRow}
            workspaceId={selectedWorkspaceId}
            onOpenArtifact={openArtifact}
            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
          />
          {row.isLastTurnRow && turn.completedAt && hasFileBadges && (
            <TurnDiffPanel
              turn={turn}
              transcript={transcript}
              onOpenFile={(filePath) => void openFileDiff(filePath)}
            />
          )}
          <TurnAssistantActionRow
            content={tailAssistantCopyContent}
            showCopyButton={row.isLastTurnRow && !!turn.completedAt}
            reserveSlot={row.isLastTurnRow && shouldReserveTurnAssistantActionSlot}
            timestampLabel={tailAssistantActionTime}
          />
          {trailingStatus && (
            <div className={trailingStatusClassName}>{trailingStatus}</div>
          )}
        </div>
      </TurnShell>
    );
  }, [
    activeSessionId,
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    onHandOffPlanToNewSession,
    onOpenSession,
    openArtifact,
    openFileDiff,
    optimisticPromptTrailingStatus,
    outboxStartedAtByPromptId,
    outboxActions,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    visibleOutboxEntries,
    visibleOptimisticPrompt,
  ]);

  return (
    <DebugProfiler id="transcript-list">
      <div className="flex-1 min-h-0" data-telemetry-block>
        <TranscriptSessionIdContext.Provider value={activeSessionId}>
          <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
            <TranscriptCanOpenSessionContext.Provider value={canOpenSession ?? null}>
              <VirtualTranscriptRowList
                key={`${selectedWorkspaceId ?? "workspace"}:${activeSessionId}`}
                rows={virtualRows}
                selectionRootRef={selectionRootRef}
                hasOlderHistory={hasOlderHistory}
                isLoadingOlderHistory={isLoadingOlderHistory}
                olderHistoryCursor={olderHistoryCursor}
                bottomInsetPx={bottomInsetPx}
                selectedWorkspaceId={selectedWorkspaceId}
                activeSessionId={activeSessionId}
                isSessionBusy={sessionViewState === "working" || sessionViewState === "needs_input"}
                pendingPromptText={visibleOptimisticPrompt?.text ?? null}
                onLoadOlderHistory={onLoadOlderHistory ?? noop}
                onScrollSample={handleTranscriptScroll}
                renderRow={renderVirtualRow}
              />
            </TranscriptCanOpenSessionContext.Provider>
          </TranscriptOpenSessionContext.Provider>
        </TranscriptSessionIdContext.Provider>
      </div>
    </DebugProfiler>
  );
}

function buildOutboxStartedAtByPromptId(
  entries: readonly PromptOutboxEntry[],
): ReadonlyMap<string, string> {
  if (entries.length === 0) {
    return EMPTY_OUTBOX_STARTED_AT_BY_PROMPT_ID;
  }
  const startedAtByPromptId = new Map<string, string>();
  for (const entry of entries) {
    startedAtByPromptId.set(entry.clientPromptId, entry.createdAt);
  }
  return startedAtByPromptId;
}

const EMPTY_OUTBOX_STARTED_AT_BY_PROMPT_ID = new Map<string, string>();

function resolveTurnPromptTiming(
  turn: TurnRecord,
  transcript: TranscriptState,
  outboxStartedAtByPromptId: ReadonlyMap<string, string>,
): { startedAt: string; isOutboxStartedAt: boolean } {
  for (const itemId of turn.itemOrder) {
    const item = transcript.itemsById[itemId];
    if (item?.kind !== "user_message" || !item.promptId) {
      continue;
    }
    const outboxStartedAt = outboxStartedAtByPromptId.get(item.promptId);
    if (outboxStartedAt) {
      return {
        startedAt: outboxStartedAt,
        isOutboxStartedAt: true,
      };
    }
  }
  return {
    startedAt: turn.startedAt,
    isOutboxStartedAt: false,
  };
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
  toolCallIdsWithProposedPlan: ReadonlySet<string>,
  toolCallId: string | null,
): boolean {
  if (!toolCallId) {
    return false;
  }
  return toolCallIdsWithProposedPlan.has(toolCallId);
}

function collectToolCallIdsWithProposedPlanForBlocks(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): Set<string> {
  const toolCallIds = new Set<string>();
  for (const block of displayBlocks) {
    if (block.kind === "collapsed_actions" || block.kind === "inline_tools") {
      for (const itemId of block.itemIds) {
        collectToolCallIdsWithProposedPlanFromItem(
          itemId,
          transcript,
          childrenByParentId,
          toolCallIds,
        );
      }
      continue;
    }
    collectToolCallIdsWithProposedPlanFromItem(
      block.itemId,
      transcript,
      childrenByParentId,
      toolCallIds,
    );
  }
  return toolCallIds;
}

function collectToolCallIdsWithProposedPlanFromItem(
  itemId: string,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  output: Set<string>,
): void {
  const item = transcript.itemsById[itemId];
  if (item?.kind === "proposed_plan" && item.plan.sourceToolCallId) {
    output.add(item.plan.sourceToolCallId);
  }
  for (const childId of childrenByParentId.get(itemId) ?? []) {
    collectToolCallIdsWithProposedPlanFromItem(
      childId,
      transcript,
      childrenByParentId,
      output,
    );
  }
}

function TurnItemSequence({
  turn,
  transcript,
  isTurnComplete,
  presentation,
  forceExpandedCollapsedActionBlockId,
  tailAssistantProseRootId,
  showCompletedArtifactFallback,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  isTurnComplete: boolean;
  presentation: ReturnType<typeof buildTurnPresentation>;
  forceExpandedCollapsedActionBlockId?: string | null;
  tailAssistantProseRootId: string | null;
  showCompletedArtifactFallback: boolean;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  const completedHistoryRootIdSet = new Set(presentation.completedHistoryRootIds);
  const toolCallIdsWithProposedPlan = useMemo(
    () => collectToolCallIdsWithProposedPlanForBlocks(
      presentation.displayBlocks,
      transcript,
      presentation.childrenByParentId,
    ),
    [presentation.childrenByParentId, presentation.displayBlocks, transcript],
  );
  let hasRenderedCompletedHistory = false;

  return (
    <ProposedPlanToolCallIdsContext.Provider value={toolCallIdsWithProposedPlan}>
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
              renderChildren={() => (
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
                            artifactToolCalls={null}
                            workspaceId={workspaceId}
                            onOpenArtifact={onOpenArtifact}
                            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                          />
                        )}
                      />
                    ))}
                </div>
              )}
            />
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
      {showCompletedArtifactFallback && tailAssistantProseRootId === null && completedArtifactToolCalls.length > 0 && (
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
    </ProposedPlanToolCallIdsContext.Provider>
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
  if (block.kind === "inline_tools") {
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
  if (block.kind === "inline_tools") {
    return block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}

function FragmentWithArtifacts({
  itemId,
  transcript,
  childrenByParentId,
  artifactToolCalls,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
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
  const canOpenSession = useContext(TranscriptCanOpenSessionContext);

  switch (item.kind) {
    case "user_message": {
      if (isSubagentWakeProvenance(item.promptProvenance)) {
        const wakeProvenance = item.promptProvenance;
        const completion =
          transcript.linkCompletionsByCompletionId[wakeProvenance.completionId] ?? null;
        const childRole: TranscriptOpenSessionRole =
          wakeProvenance.type === "linkWake"
          && wakeProvenance.relation === "cowork_coding_session"
            ? "cowork-coding-child"
            : "linked-child";
        const childSessionId = completion?.childSessionId ?? null;
        const canOpenChild = !!openSession
          && !!childSessionId
          && (canOpenSession?.(childSessionId, childRole) ?? true);
        return (
          <div className="flex justify-end">
            <SubagentWakeBadge
              label={wakeProvenance.label ?? completion?.label ?? null}
              childSessionId={childSessionId}
              outcome={completion?.outcome ?? null}
              titleFallback={
                wakeProvenance.type === "linkWake"
                && wakeProvenance.relation === "cowork_coding_session"
                  ? "Coding session"
                  : "Subagent"
              }
              onOpenChild={canOpenChild
                ? (targetSessionId) => {
                  useSessionDirectoryStore.getState().recordRelationshipHint(targetSessionId, {
                    kind: wakeProvenance.type === "subagentWake"
                      ? "subagent_child"
                      : childRole === "cowork-coding-child"
                        ? "cowork_child"
                        : "linked_child",
                    parentSessionId: sessionId,
                    sessionLinkId: wakeProvenance.sessionLinkId,
                    relation: wakeProvenance.type === "linkWake"
                      ? wakeProvenance.relation
                      : "subagent",
                    workspaceId,
                  });
                  openSession(targetSessionId, childRole);
                }
                : undefined}
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
          />
        );
      }

      if (isAgentSessionProvenance(item.promptProvenance)) {
        const sourceSessionId = item.promptProvenance.sourceSessionId;
        const canOpenParent = !!openSession
          && (canOpenSession?.(sourceSessionId, "agent-parent") ?? true);
        return (
          <UserMessage
            sessionId={sessionId}
            content={item.text}
            contentParts={item.contentParts}
            showCopyButton
            timestampLabel={resolveUserMessageActionTime(item)}
            footer={(
              <UserMessageProvenanceChrome
                sourceSessionId={sourceSessionId}
                label={item.promptProvenance.label ?? null}
                onOpenParent={canOpenParent
                  ? (parentSessionId) => openSession(parentSessionId, "agent-parent")
                  : undefined}
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
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
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
            <div className="flex flex-col w-full max-w-full space-y-1 break-words">
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
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
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
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
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

  if (rows.length === 1) {
    return <>{rows[0]}</>;
  }

  const hasOnlyFileChangeRows = rows.length === fileChanges.length;
  return (
    <div className={hasOnlyFileChangeRows ? "flex flex-col" : "space-y-1.5"}>
      {rows}
    </div>
  );
}

function ToolCallGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
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
      renderChildren={() => (
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
                onHandOffPlanToNewSession={onHandOffPlanToNewSession}
              />
            ))}
          </div>
        </div>
      )}
    />
  );
}

function AgentGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const executionState = resolveSubagentExecutionState(item);
  const asyncLaunch = parseAsyncSubagentLaunch(item);
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  const launchResult = parseSubagentLaunchResult(item);
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

  const description = subagentDisplay.title.trim();
  const shouldShowDescription = description.length > 0
    && description.toLowerCase() !== "subagent";
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
          onHandOffPlanToNewSession={onHandOffPlanToNewSession}
        />
      )}
    />
  );
  const headerVerb = executionState === "failed"
    ? "Subagent launch failed"
    : isRunning
      ? "Creating subagent"
      : "Subagent created";
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

      {/* Agent body — indented with left border */}
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

function OutboxPromptTrailingStatus({ entry }: { entry: PromptOutboxEntry | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (entry?.deliveryState !== "accepted_running") {
      return;
    }
    const acceptedAtMs = resolveOutboxAcceptedRunningReferenceMs(entry);
    const remainingMs = OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS - (Date.now() - acceptedAtMs);
    if (remainingMs <= 0) {
      setNowMs(Date.now());
      return;
    }
    const timeout = window.setTimeout(() => {
      setNowMs(Date.now());
    }, remainingMs + 50);
    return () => window.clearTimeout(timeout);
  }, [
    entry?.acceptedAt,
    entry?.clientPromptId,
    entry?.createdAt,
    entry?.deliveryState,
    entry?.dispatchedAt,
  ]);

  return <>{resolveOutboxPromptTrailingStatus(entry, nowMs)}</>;
}

function resolveOutboxPromptTrailingStatus(
  entry: PromptOutboxEntry | null,
  nowMs = Date.now(),
): ReactNode {
  if (!entry) {
    return null;
  }
  switch (entry.deliveryState) {
    case "failed_before_dispatch":
      return entry.errorMessage ? `Not sent: ${entry.errorMessage}` : "Not sent";
    case "unknown_after_dispatch":
      return "Waiting for confirmation…";
    case "preparing":
    case "dispatching":
    case "waiting_for_session":
      return resolvePendingPromptTrailingStatus(entry.createdAt, "working", true);
    case "accepted_running":
      if (hasAcceptedRunningOutboxEntryExceededEchoGrace(entry, nowMs)) {
        return "Waiting for transcript…";
      }
      return resolvePendingPromptTrailingStatus(entry.createdAt, "working", true);
    default:
      return null;
  }
}

function hasAcceptedRunningOutboxEntryExceededEchoGrace(
  entry: PromptOutboxEntry,
  nowMs: number,
): boolean {
  return nowMs - resolveOutboxAcceptedRunningReferenceMs(entry)
    >= OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS;
}

function resolveOutboxAcceptedRunningReferenceMs(entry: PromptOutboxEntry): number {
  const parsed = Date.parse(entry.acceptedAt ?? entry.dispatchedAt ?? entry.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function renderOutboxPromptControls(
  entry: PromptOutboxEntry,
  actions: OutboxActionHandlers,
): ReactNode {
  if (entry.deliveryState === "failed_before_dispatch") {
    return (
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.retryPrompt(entry.clientPromptId)}
        >
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.dismissPrompt(entry.clientPromptId)}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  if (entry.deliveryState === "unknown_after_dispatch") {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.dismissPrompt(entry.clientPromptId)}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  return null;
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
