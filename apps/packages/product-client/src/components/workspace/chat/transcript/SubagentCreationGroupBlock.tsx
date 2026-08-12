import { useMemo, useState } from "react";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { AgentIdentityChip } from "#product/components/workspace/chat/transcript/AgentIdentityChip";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { Button } from "#product/primitives/Button";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { deriveAgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
} from "#product/domain/chats/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { normalizeToolResultText } from "#product/domain/chats/tools/tool-result-text";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import {
  subagentCreationReceiptEntryId,
  useTranscriptEntryMotion,
} from "#product/components/workspace/chat/transcript/TranscriptEntryMotionContext";
import {
  historicalSubagentProvenanceRemainsAuthoritative,
  isDurableSubagentRelationship,
  resolveCurrentSessionRelationship,
  useAgentsPaneNavigationActions,
} from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";

interface SpawnReceipt {
  key: string;
  item: ToolCallItem;
  sessionId: string | null;
  workspaceId: string | null;
  title: string;
  failed: boolean;
}

export function SubagentCreationGroupBlock({
  itemIds,
  transcript,
  animateEntries = false,
}: {
  itemIds: readonly string[];
  transcript: TranscriptState;
  animateEntries?: boolean;
}) {
  const openSession = useTranscriptOpenSession();
  const canOpenSession = useTranscriptCanOpenSession();
  const transcriptSessionId = useTranscriptSessionId();
  const parentDurableSessionId = useSessionDirectoryStore((state) =>
    transcriptSessionId
      ? state.entriesById[transcriptSessionId]?.materializedSessionId ?? transcriptSessionId
      : null
  );
  const parentWorkspaceId = useSessionDirectoryStore((state) =>
    transcriptSessionId ? state.entriesById[transcriptSessionId]?.workspaceId ?? null : null
  );
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces({ enabled: false });
  const projectedWorkspaceIds = useMemo(
    () => new Set(workspaceCollections?.allWorkspaces.map((workspace) => workspace.id) ?? []),
    [workspaceCollections?.allWorkspaces],
  );
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const receipts = itemIds.flatMap((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call" ? [spawnReceipt(item)] : [];
  });
  const visibleReceipts = receipts.filter((receipt) => receipt.sessionId || receipt.failed);
  if (visibleReceipts.length === 0) {
    return null;
  }

  const failedCount = visibleReceipts.filter((receipt) => receipt.failed).length;
  const successfulCount = visibleReceipts.length - failedCount;
  const trailingVerb = successfulCount > 0
    ? failedCount > 0
      ? `started working · ${failedCount} failed`
      : "started working"
    : failedCount === 1
      ? "failed to start"
      : `${failedCount} failed to start`;

  return (
    <>
      <div
        data-subagent-creation-run
        className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-chat leading-8"
      >
      {visibleReceipts.map((receipt) => {
        if (!receipt.sessionId) {
          return (
            <span
              key={receipt.key}
              data-subagent-spawn-failed
              className="inline-flex h-7 max-w-72 min-w-0 items-center rounded-full border border-destructive/25 bg-destructive/5 px-2 text-destructive/80"
            >
              <span className="truncate">{receipt.title}</span>
            </span>
          );
        }
        return (
          <SpawnIdentityReceipt
            key={receipt.key}
            receipt={receipt}
            sessionId={receipt.sessionId}
            selectedWorkspaceId={selectedWorkspaceId}
            projectedWorkspaceIds={projectedWorkspaceIds}
            openSession={openSession}
            canOpenSession={canOpenSession}
            openWorkspaceSession={openWorkspaceSession}
            parentDurableSessionId={parentDurableSessionId}
            parentWorkspaceId={parentWorkspaceId}
            animateEntry={animateEntries}
          />
        );
      })}
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-chat-transcript-ignore
        data-subagent-creation-details-toggle
        aria-label={detailsExpanded ? "Hide agent creation details" : "Show agent creation details"}
        aria-expanded={detailsExpanded}
        onClick={() => setDetailsExpanded((value) => !value)}
        className={`relative top-px inline-block cursor-pointer align-middle hover:underline focus-visible:underline ${
          failedCount > 0 && successfulCount === 0
            ? "text-destructive/80"
            : "text-foreground/90"
        }`}
      >
        {trailingVerb}
      </Button>
      </div>
      {detailsExpanded ? (
        <div className="mt-1.5" data-subagent-creation-details>
          <ToolActionDetailsPanel>
            <AutoHideScrollArea
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            >
              <div className="divide-y divide-border/60">
                {visibleReceipts.map((receipt) => (
                  <div
                    key={receipt.key}
                    data-subagent-creation-detail={receipt.key}
                    className="px-3 py-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-ui-sm text-muted-foreground">
                      <span className="min-w-0 truncate text-foreground/80">{receipt.title}</span>
                      <span className="shrink-0">{receipt.item.status}</span>
                    </div>
                    <pre className="m-0 whitespace-pre-wrap font-mono text-readable-code text-muted-foreground">
                      {creationResultText(receipt.item) ?? "No structured result returned."}
                    </pre>
                  </div>
                ))}
              </div>
            </AutoHideScrollArea>
          </ToolActionDetailsPanel>
        </div>
      ) : null}
    </>
  );
}

function SpawnIdentityReceipt({
  receipt,
  sessionId,
  selectedWorkspaceId,
  projectedWorkspaceIds,
  openSession,
  canOpenSession,
  openWorkspaceSession,
  parentDurableSessionId,
  parentWorkspaceId,
  animateEntry,
}: {
  receipt: SpawnReceipt;
  sessionId: string;
  selectedWorkspaceId: string | null;
  projectedWorkspaceIds: ReadonlySet<string>;
  openSession: ReturnType<typeof useTranscriptOpenSession>;
  canOpenSession: ReturnType<typeof useTranscriptCanOpenSession>;
  openWorkspaceSession: ReturnType<
    typeof useWorkspaceActivationWorkflow
  >["openWorkspaceSession"];
  parentDurableSessionId: string | null;
  parentWorkspaceId: string | null;
  animateEntry: boolean;
}) {
  const { openAgentsPaneTarget } = useAgentsPaneNavigationActions();
  const shouldAnimateEntry = useTranscriptEntryMotion(
    subagentCreationReceiptEntryId(receipt.key),
    animateEntry,
  );
  const navigationSessionId = useSessionDirectoryStore((state) =>
    state.clientSessionIdByMaterializedSessionId[sessionId] ?? sessionId
  );
  const directoryWorkspaceId = useSessionDirectoryStore((state) =>
    state.entriesById[navigationSessionId]?.workspaceId
      ?? resolveCurrentSessionRelationship(state, sessionId).workspaceId
  );
  const hasDirectoryEntry = useSessionDirectoryStore(
    (state) => Boolean(state.entriesById[navigationSessionId]),
  );
  const directoryRelationship = useSessionDirectoryStore((state) =>
    resolveCurrentSessionRelationship(state, sessionId).relationship
  );
  const identity = buildDelegatedAgentIdentity({
    id: sessionId,
    title: receipt.title,
    sessionId,
  });
  const historicalTargetWorkspaceId = receipt.workspaceId ?? parentWorkspaceId;
  const navigationWorkspaceId = directoryWorkspaceId ?? historicalTargetWorkspaceId;
  const hasDurableSubagentAuthority = isDurableSubagentRelationship(directoryRelationship);
  const hasMatchingPendingSubagentAuthority = directoryRelationship?.kind === "pending"
    && historicalSubagentProvenanceRemainsAuthoritative(
      directoryRelationship,
      directoryWorkspaceId !== null,
    )
    && directoryWorkspaceId === historicalTargetWorkspaceId
    && directoryWorkspaceId === selectedWorkspaceId;
  const currentRelationshipKeepsOrdinaryNavigation = Boolean(
    directoryRelationship
    && directoryRelationship.kind !== "pending"
    && !isDurableSubagentRelationship(directoryRelationship),
  );
  const openRole: TranscriptOpenSessionRole = directoryRelationship?.kind === "root"
    ? "generic"
    : directoryRelationship?.kind === "cowork_child"
      ? "cowork-coding-child"
      : "linked-child";
  const isCurrentWorkspace = navigationWorkspaceId !== null
    && navigationWorkspaceId === selectedWorkspaceId;
  const currentSubagentOwnsNavigation = isCurrentWorkspace
    && (hasDurableSubagentAuthority || hasMatchingPendingSubagentAuthority);
  const paneParentCandidate = isDurableSubagentRelationship(directoryRelationship)
    ? directoryRelationship.parentSessionId
    : parentDurableSessionId;
  const paneParentSessionId = useSessionDirectoryStore((state) =>
    paneParentCandidate
      ? state.entriesById[paneParentCandidate]?.materializedSessionId ?? paneParentCandidate
      : null
  );
  const canOpenInAgentsPane = Boolean(
    currentSubagentOwnsNavigation
    && navigationWorkspaceId
    && paneParentSessionId,
  );
  const usesTranscriptNavigation = Boolean(
    openSession
    && (isCurrentWorkspace || !navigationWorkspaceId)
    && (canOpenSession?.(navigationSessionId, openRole) ?? true),
  );
  const canUseOrdinaryNavigation = Boolean(
    !currentSubagentOwnsNavigation
    && (hasDurableSubagentAuthority || currentRelationshipKeepsOrdinaryNavigation),
  );
  const canOpen = Boolean(
    canOpenInAgentsPane
    || (canUseOrdinaryNavigation && usesTranscriptNavigation)
    || (canUseOrdinaryNavigation && (
      navigationWorkspaceId
      && (hasDirectoryEntry || projectedWorkspaceIds.has(navigationWorkspaceId))
    )),
  );

  return (
    <span
      data-subagent-spawn-entry={receipt.key}
      data-subagent-spawn-entry-motion={shouldAnimateEntry ? "true" : undefined}
      className={`inline-flex ${shouldAnimateEntry ? "subagent-spawn-chip-enter" : ""}`.trim()}
    >
      <AgentIdentityChip
        identity={identity}
        onOpen={canOpen
          ? () => {
            if (
              canOpenInAgentsPane
              && navigationWorkspaceId
              && paneParentSessionId
            ) {
              openAgentsPaneTarget({
                workspaceId: navigationWorkspaceId,
                parentSessionId: paneParentSessionId,
                childSessionId: sessionId,
                historicalSubagentProvenance: true,
              });
              return;
            }
            if (usesTranscriptNavigation) {
              openSession?.(navigationSessionId, openRole);
              return;
            }
            if (navigationWorkspaceId) {
              void openWorkspaceSession({
                workspaceId: navigationWorkspaceId,
                sessionId: navigationSessionId,
              });
            }
          }
          : undefined}
      />
    </span>
  );
}

function spawnReceipt(item: ToolCallItem): SpawnReceipt {
  const workspacePresentation = deriveAgentOperationsReceiptPresentation(item);
  if (workspacePresentation?.action === "create_agent") {
    return {
      key: item.itemId,
      item,
      sessionId: workspacePresentation.agent?.sessionId ?? null,
      workspaceId: workspacePresentation.agent?.workspaceId ?? null,
      title: workspacePresentation.agent?.title ?? readInputTitle(item) ?? "Subagent",
      failed: item.status === "failed",
    };
  }

  const launch = parseSubagentLaunchResult(item);
  return {
    key: item.itemId,
    item,
    sessionId: launch?.childSessionId ?? null,
    workspaceId: null,
    title: resolveSubagentLaunchDisplay(item).title,
    failed: item.status === "failed",
  };
}

function creationResultText(item: ToolCallItem): string | null {
  const toolResultText = item.contentParts.flatMap((part) =>
    part.type === "tool_result_text" ? [part.text] : []
  ).join("\n\n");
  if (toolResultText.trim()) {
    return normalizeToolResultText(toolResultText);
  }
  if (item.rawOutput === null || item.rawOutput === undefined) {
    return null;
  }
  if (typeof item.rawOutput === "string") {
    return normalizeToolResultText(item.rawOutput);
  }
  try {
    return JSON.stringify(item.rawOutput, null, 2);
  } catch {
    return null;
  }
}

function readInputTitle(item: ToolCallItem): string | null {
  if (!item.rawInput || typeof item.rawInput !== "object" || Array.isArray(item.rawInput)) {
    return null;
  }
  const input = item.rawInput as Record<string, unknown>;
  for (const key of ["title", "label", "task"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
