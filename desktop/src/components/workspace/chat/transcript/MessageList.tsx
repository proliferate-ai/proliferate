import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantMessage } from "./AssistantMessage";
import { ClaudePlanCard } from "./ClaudePlanCard";
import { CopyMessageButton } from "./CopyMessageButton";
import { SystemMessage } from "./SystemMessage";
import { UserMessage } from "./UserMessage";
import { StreamingIndicator } from "./StreamingIndicator";
import { TurnSeparator } from "./TurnSeparator";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import {
  ToolCallBlock,
  ToolCallLeadingAffordance,
  TOOL_CALL_BODY_MAX_HEIGHT_CLASS,
} from "@/components/workspace/chat/tool-calls/ToolCallBlock";
import { BashCommandCall } from "@/components/workspace/chat/tool-calls/BashCommandCall";
import { FileChangeCall } from "@/components/workspace/chat/tool-calls/FileChangeCall";
import { FileReadCall } from "@/components/workspace/chat/tool-calls/FileReadCall";
import { ReadGroupBlock } from "@/components/workspace/chat/tool-calls/ReadGroupBlock";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import { CoworkArtifactToolCallBlock } from "@/components/workspace/chat/tool-calls/CoworkArtifactToolCallBlock";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
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
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useMessageListScroll } from "@/hooks/chat/use-message-list-scroll";
import { useOpenCoworkArtifact } from "@/hooks/cowork/use-open-cowork-artifact";
import { useBrailleFillsweep } from "@/hooks/ui/use-braille-sweep";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@/lib/domain/chat/cowork-artifact-tool-presentation";
import {
  describeToolCallDisplay,
  type ToolDisplayIconKey,
} from "@/lib/domain/chat/tool-call-display";
import { buildTurnPresentation } from "@/lib/domain/chat/transcript-presentation";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/claude-plan-tool-call";
import {
  parseAsyncSubagentLaunch,
  resolveSubagentExecutionState,
  type SubagentExecutionState,
} from "@/lib/domain/chat/subagent-launch";
import {
  buildSubagentBrailleColorMap,
  resolveSubagentBrailleColor,
} from "@/lib/domain/chat/subagent-braille-color";
import {
  turnHasAssistantRenderableTranscriptContent,
  resolveVisibleTranscriptPendingPrompt,
  shouldShowPendingPromptActivity,
} from "@/lib/domain/chat/pending-prompts";
import {
  lastTopLevelItemIsAssistantProseWithText,
  shouldAllowTurnTrailingStatus,
} from "@/lib/domain/chat/transcript-trailing-status";
import type {
  FileChangeContentPart,
  FileReadContentPart,
  PendingPromptEntry,
  TranscriptState,
  ToolCallContentPart,
  ToolCallItem,
  ToolInputTextContentPart,
  ToolResultTextContentPart,
  TranscriptItem,
  TurnRecord,
  TerminalOutputContentPart,
} from "@anyharness/sdk";
import type { SessionViewState } from "@/lib/domain/sessions/activity";

const TURN_HORIZONTAL_PADDING = "px-7";
const ASSISTANT_ACTION_SLOT_HEIGHT = "h-6";

/**
 * Minimum height of the trailing-status slot at the bottom of an in-progress
 * turn (StreamingIndicator while "working", "Waiting for your input" while
 * "needs_input"). Pinned so that swapping the indicator for the first line of
 * the assistant's prose reply is a zero-delta layout transition — no scroll
 * bump, no content jump.
 *
 * Value derivation (keep in sync if any of these move):
 *   • text-chat single-line height — `--text-chat--line-height` in index.css
 *     (currently `1.125rem` / 18px)
 *   • trailing assistant action slot — `h-6` in this file
 *     (24px, reserved only once the latest in-progress turn has tail
 *     assistant prose)
 *   ----
 *   = 18px + 24px = 42px = 2.625rem
 */
const TRAILING_STATUS_MIN_HEIGHT = "min-h-[2.625rem]";

interface MessageListProps {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  optimisticPrompt: PendingPromptEntry | null;
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
}

export function MessageList({
  activeSessionId,
  selectedWorkspaceId,
  optimisticPrompt,
  transcript,
  sessionViewState,
}: MessageListProps) {
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
  const { openFileDiff } = useWorkspaceFileActions();
  const { openArtifact } = useOpenCoworkArtifact();
  const subagentBrailleColors = useMemo(
    () => buildSubagentBrailleColorMap(transcript),
    [transcript],
  );

  const totalItems = transcript.turnOrder.reduce(
    (sum, tid) => sum + (transcript.turnsById[tid]?.itemOrder.length ?? 0),
    0,
  );
  const latestTurnHasAssistantRenderableContent = turnHasAssistantRenderableTranscriptContent(
    latestTurn,
    transcript,
  );
  const visiblePendingPrompt = resolveVisibleTranscriptPendingPrompt({
    pendingPrompts: transcript.pendingPrompts,
    optimisticPrompt,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnHasAssistantRenderableContent,
  });
  const pendingPromptTrailingStatus = visiblePendingPrompt
    && shouldShowPendingPromptActivity({ optimisticPrompt, sessionViewState })
    ? resolvePendingPromptTrailingStatus(
      visiblePendingPrompt.queuedAt,
      sessionViewState,
      optimisticPrompt !== null,
    )
    : null;
  const { scrollRef, contentRef } = useMessageListScroll({
    totalItems,
    pendingPromptText: visiblePendingPrompt?.text ?? null,
    isSessionBusy: sessionViewState === "working" || sessionViewState === "needs_input",
    selectedWorkspaceId,
    activeSessionId,
  });

  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <AutoHideScrollArea className="h-full" ref={scrollRef}>
        <div ref={contentRef} className="max-w-3xl mx-auto pt-4 pb-10">
          {transcript.turnOrder.map((turnId, turnIdx) => {
            const turn = transcript.turnsById[turnId];
            if (!turn) return null;
            const isLatestTurn = turnId === latestTurnId;
            const isLatestTurnInProgress =
              isLatestTurn && !turn.completedAt;
            const shouldHideEmptyLatestTurn =
              visiblePendingPrompt !== null
              && isLatestTurnInProgress
              && !latestTurnHasAssistantRenderableContent;
            if (shouldHideEmptyLatestTurn) {
              return null;
            }
            const hasFileBadges = turn.fileBadges.length > 0;
            const presentation = buildTurnPresentation(turn, transcript);
            const tailAssistantProseRootId = findTailAssistantProseRootId(
              presentation,
              transcript,
            );
            const tailAssistantCopyContent = getAssistantProseContent(
              tailAssistantProseRootId,
              transcript,
            );
            const shouldReserveTurnAssistantActionSlot =
              isLatestTurnInProgress
              && !!tailAssistantCopyContent
              && lastTopLevelItemIsAssistantProseWithText(turn, transcript);

            // Hide the trailing indicator only while the assistant prose item
            // itself is actively streaming. If Codex closes the prose item but
            // keeps working internally, the trailing indicator should return.
            const trailingStatus =
              shouldAllowTurnTrailingStatus({
                turn,
                transcript,
                isLatestTurnInProgress,
              })
                ? resolveTurnTrailingStatus(turn.startedAt, sessionViewState)
                : null;

            return (
              <TurnShell key={turnId} isFirst={turnIdx === 0}>
                <div className={`flex flex-col gap-2 ${tailAssistantCopyContent ? "group/turn" : ""}`}>
                  <TurnItemSequence
                    turnId={turnId}
                    turn={turn}
                    transcript={transcript}
                    isTurnComplete={!!turn.completedAt}
                    presentation={presentation}
                    tailAssistantProseRootId={tailAssistantProseRootId}
                    workspaceId={selectedWorkspaceId}
                    onOpenArtifact={openArtifact}
                    subagentBrailleColors={subagentBrailleColors}
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
                  />
                  {trailingStatus && (
                    <div className={TRAILING_STATUS_MIN_HEIGHT}>{trailingStatus}</div>
                  )}
                </div>
              </TurnShell>
            );
          })}
          {visiblePendingPrompt && (
            <TurnShell key="pending-prompt" isFirst={transcript.turnOrder.length === 0}>
              <div className="flex flex-col gap-2">
                <UserMessage content={visiblePendingPrompt.text} />
                {pendingPromptTrailingStatus && (
                  <div className={TRAILING_STATUS_MIN_HEIGHT}>{pendingPromptTrailingStatus}</div>
                )}
              </div>
            </TurnShell>
          )}
        </div>
      </AutoHideScrollArea>
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
): ReactNode {
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
  for (let i = presentation.rootIds.length - 1; i >= 0; i--) {
    const rootId = presentation.rootIds[i];
    if (presentation.collapsedRootIds.has(rootId)) continue;
    const item = transcript.itemsById[rootId];
    if (item?.kind === "assistant_prose" && item.text) {
      return rootId;
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

function TurnItemSequence({
  turnId,
  turn,
  transcript,
  isTurnComplete,
  presentation,
  tailAssistantProseRootId,
  workspaceId,
  onOpenArtifact,
  subagentBrailleColors,
}: {
  turnId: string;
  turn: TurnRecord;
  transcript: TranscriptState;
  isTurnComplete: boolean;
  presentation: ReturnType<typeof buildTurnPresentation>;
  tailAssistantProseRootId: string | null;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
}) {
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  let hasRenderedSummary = false;

  return (
    <>
      {presentation.rootIds.map((itemId) => {
        if (presentation.collapsedRootIds.has(itemId)) {
          if (hasRenderedSummary || !presentation.collapsedSummary) {
            return null;
          }
          hasRenderedSummary = true;

          const collapsedRootIds = presentation.rootIds.filter((rootId) =>
            presentation.collapsedRootIds.has(rootId)
          );

          // Check if there's a final assistant message after the collapsed block
          const hasTrailingAssistantProse = presentation.rootIds.some((rootId) => {
            if (presentation.collapsedRootIds.has(rootId)) return false;
            const item = transcript.itemsById[rootId];
            return item?.kind === "assistant_prose" && !!item.text;
          });

          return (
            <ToolCallSummary
              key={`${turnId}-collapsed-summary`}
              icon={<ClipboardList />}
              label="Work history"
              summary={formatCollapsedSummary(presentation.collapsedSummary)}
              typeIcons={buildCollapsedSummaryIcons(presentation.collapsedSummary)}
              itemCount={collapsedRootIds.length}
              showFinalSeparator={hasTrailingAssistantProse}
            >
              <div className="space-y-1">
                {collapsedRootIds.map((collapsedRootId) => (
                  <TranscriptTreeNode
                    key={collapsedRootId}
                    itemId={collapsedRootId}
                    transcript={transcript}
                    childrenByParentId={presentation.childrenByParentId}
                    workspaceId={workspaceId}
                    onOpenArtifact={onOpenArtifact}
                    subagentBrailleColors={subagentBrailleColors}
                  />
                ))}
              </div>
            </ToolCallSummary>
          );
        }

        if (presentation.readGroupedIds.has(itemId)) {
          const group = presentation.readGroups.get(itemId);
          if (!group) return null;

          return (
            <ReadGroupBlock key={`read-group-${itemId}`} group={group}>
              {group.memberIds.map((memberId) => (
                <TranscriptTreeNode
                  key={memberId}
                  itemId={memberId}
                  transcript={transcript}
                  childrenByParentId={presentation.childrenByParentId}
                  workspaceId={workspaceId}
                  onOpenArtifact={onOpenArtifact}
                  subagentBrailleColors={subagentBrailleColors}
                />
              ))}
            </ReadGroupBlock>
          );
        }

        return (
          <FragmentWithArtifacts
            key={itemId}
            itemId={itemId}
            transcript={transcript}
            childrenByParentId={presentation.childrenByParentId}
            subagentBrailleColors={subagentBrailleColors}
            artifactToolCalls={
              itemId === tailAssistantProseRootId ? completedArtifactToolCalls : null
            }
            workspaceId={workspaceId}
            onOpenArtifact={onOpenArtifact}
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

function FragmentWithArtifacts({
  itemId,
  transcript,
  childrenByParentId,
  subagentBrailleColors,
  artifactToolCalls,
  workspaceId,
  onOpenArtifact,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  subagentBrailleColors: Map<string, string>;
  artifactToolCalls: ToolCallItem[] | null;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
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
  workspaceId,
  onOpenArtifact,
}: {
  item: TranscriptItem;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
}) {
  switch (item.kind) {
    case "user_message":
      return <UserMessage content={item.text} showCopyButton />;

    case "assistant_prose": {
      if (!item.text) return null;

      return (
        <div className="flex justify-start relative">
          <div data-chat-selection-unit className="flex flex-col w-full min-w-0 max-w-full break-words">
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

    case "error":
      return (
        <p className="text-xs text-destructive py-1">{item.message}</p>
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
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
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
      />
    );
  }

  return (
    <TranscriptItemBlock
      item={item}
      workspaceId={workspaceId}
      onOpenArtifact={onOpenArtifact}
    />
  );
}

function TurnAssistantActionRow({
  content,
  showCopyButton = false,
  reserveSlot = false,
}: {
  content: string | null;
  showCopyButton?: boolean;
  reserveSlot?: boolean;
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
  if (
    item.semanticKind === "cowork_artifact_create"
    || item.semanticKind === "cowork_artifact_update"
  ) {
    return (
      <CoworkArtifactToolCallBlock
        item={item}
        onOpenArtifact={
          workspaceId
            ? (artifactId) => onOpenArtifact(workspaceId, artifactId)
            : undefined
        }
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
      <ToolCallBlock
        key="result"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        name={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
        status={status}
        hint={fallbackDisplay.hint}
      >
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/25">
          <AutoHideScrollArea className="w-full" viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}>
            <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-xs text-foreground">
              {normalizedResultText}
            </pre>
          </AutoHideScrollArea>
        </div>
      </ToolCallBlock>,
    );
  }

  if (rows.length === 0) {
    rows.push(
      <ToolCallBlock
        key="tool"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        name={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
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
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
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
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  subagentBrailleColors: Map<string, string>;
}) {
  const executionState = resolveSubagentExecutionState(item);
  const asyncLaunch = parseAsyncSubagentLaunch(item);
  const brailleColor = resolveSubagentBrailleColor(subagentBrailleColors, item);
  const isRunning =
    executionState === "running" || executionState === "background";
  const [expanded, setExpanded] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(false);

  const promptText = item.contentParts
    .filter((p): p is ToolInputTextContentPart => p.type === "tool_input_text")
    .map((p) => p.text)
    .join("\n\n");
  const normalizedPrompt = promptText.trim();

  // Agent synthesis lives in the agent item's own tool_result_text content parts
  const agentResultText = item.contentParts
    .filter((p): p is ToolResultTextContentPart => p.type === "tool_result_text")
    .map((p) => p.text)
    .join("\n\n");
  const normalizedAgentResult = normalizeToolResultText(agentResultText);

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

  const description = item.title ?? "Agent task";
  const hasWork = childIds.length > 0;
  const hasBodyContent = hasWork || !!normalizedPrompt || !!normalizedAgentResult;
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
        onClick={() => headerExpandable && setExpanded(!expanded)}
        className={`group/tool-row inline-flex items-center gap-1 rounded-md pl-0.5 pr-1.5 py-1 text-base leading-5 transition-colors ${
          headerExpandable
            ? "cursor-pointer text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            : "cursor-default text-muted-foreground"
        }`}
      >
        <ToolCallLeadingAffordance
          icon={<AgentHeaderIcon state={executionState} color={brailleColor} />}
          expandable={headerExpandable}
          expanded={expanded}
        />
        <span className="font-[460] text-foreground/90">{description}</span>
        {!expanded && collapsedSummary && (
          <span className="ml-1 text-sm text-muted-foreground">{collapsedSummary}</span>
        )}
      </div>

      {/* Agent body — indented with left border */}
      {expanded && hasBodyContent && <div className="ml-2 border-l border-border/70 pl-3">
        {normalizedPrompt && (
          <AgentPromptBlock content={normalizedPrompt} />
        )}

        {/* Internal work — collapsed when complete */}
        {hasWork && (
          isRunning ? (
            <div className="space-y-1">
              {childIds.map((childId) => (
                <TranscriptTreeNode
                  key={childId}
                  itemId={childId}
                  transcript={transcript}
                  childrenByParentId={childrenByParentId}
                  workspaceId={workspaceId}
                  onOpenArtifact={onOpenArtifact}
                  subagentBrailleColors={subagentBrailleColors}
                />
              ))}
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
                  {childIds.map((childId) => (
                    <TranscriptTreeNode
                      key={childId}
                      itemId={childId}
                      transcript={transcript}
                      childrenByParentId={childrenByParentId}
                      workspaceId={workspaceId}
                      onOpenArtifact={onOpenArtifact}
                      subagentBrailleColors={subagentBrailleColors}
                    />
                  ))}
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
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Async subagent launched successfully. You&apos;ll be notified automatically when it completes.
      </p>
      {hasLaunchDetails && (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
                <div className="whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
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

function AgentPromptBlock({ content }: { content: string }) {
  return (
    <div className="mt-1">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Prompt To Subagent
      </div>
      <div className="overflow-hidden rounded-md border border-border/60 bg-muted/25">
        <AutoHideScrollArea className="w-full" viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}>
          <div className="px-3 py-2 text-sm leading-relaxed text-muted-foreground">
            <MarkdownRenderer
              content={content}
              className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            />
          </div>
        </AutoHideScrollArea>
      </div>
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
    <div data-chat-selection-unit className="mt-1">
      <div
        className={`relative ${!resultExpanded && needsTruncation ? "overflow-hidden" : ""}`}
        style={!resultExpanded && needsTruncation ? { maxHeight: AGENT_RESULT_COLLAPSED_HEIGHT } : undefined}
      >
        <div ref={contentRef} className="text-chat leading-relaxed select-text text-foreground">
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

function normalizeToolResultText(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:console|text|bash|sh)?\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
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
