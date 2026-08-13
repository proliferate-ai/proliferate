import { useMemo, useState } from "react";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { Button } from "#product/primitives/Button";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { deriveAgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { normalizeToolResultText } from "#product/domain/chats/tools/tool-result-text";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { deriveAuthoritativeAgentOperation } from "#product/lib/domain/sessions/agent-operations-authority";
import {
  readAgentOperationsInput,
  readAgentOperationsOutput,
} from "#product/domain/chats/tools/agent-operations-tool-wire";
import { SpawnIdentityReceipt } from "./SpawnIdentityReceipt";

export interface SpawnReceipt {
  key: string;
  item: ToolCallItem;
  sessionId: string | null;
  workspaceId: string | null;
  title: string;
  pending: boolean;
  failed: boolean;
  historicalNavigationAuthorized: boolean;
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
  const parentAuthorityWorkspaceId = parentWorkspaceId ?? selectedWorkspaceId;
  const { data: workspaceCollections } = useWorkspaces({ enabled: false });
  const projectedWorkspaceIds = useMemo(
    () => new Set(workspaceCollections?.allWorkspaces.map((workspace) => workspace.id) ?? []),
    [workspaceCollections?.allWorkspaces],
  );
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const receipts = itemIds.flatMap((itemId) => {
    const item = transcript.itemsById[itemId];
    if (item?.kind !== "tool_call") {
      return [];
    }
    const receipt = spawnReceipt(item, parentDurableSessionId, parentAuthorityWorkspaceId);
    return receipt ? [receipt] : [];
  });
  const visibleReceipts = receipts;
  if (visibleReceipts.length === 0) {
    return null;
  }

  const failedCount = visibleReceipts.filter((receipt) => receipt.failed).length;
  const pendingCount = visibleReceipts.filter((receipt) => receipt.pending).length;
  const successfulCount = visibleReceipts.filter((receipt) => receipt.sessionId).length;
  const unresolvedCount = visibleReceipts.length - failedCount - pendingCount - successfulCount;
  const trailingVerb = creationRunVerb({
    successfulCount,
    pendingCount,
    failedCount,
    unresolvedCount,
  });

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
              data-subagent-spawn-failed={receipt.failed ? "true" : undefined}
              data-subagent-spawn-pending={receipt.pending ? "true" : undefined}
              className={`inline-flex h-7 max-w-72 min-w-0 items-center gap-1.5 rounded-full border px-2 ${
                receipt.failed
                  ? "border-destructive/25 bg-destructive/5 text-destructive/80"
                  : "border-border/70 bg-surface-elevated text-muted-foreground"
              }`}
            >
              <ProliferateIcon
                data-agent-operations-product-mark
                className="icon-compact shrink-0 text-faint [font-size:var(--text-chat)]"
              />
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
            parentWorkspaceId={parentAuthorityWorkspaceId}
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

function spawnReceipt(
  item: ToolCallItem,
  parentDurableSessionId: string | null,
  parentWorkspaceId: string | null,
): SpawnReceipt | null {
  const workspacePresentation = deriveAgentOperationsReceiptPresentation(item);
  if (workspacePresentation?.action !== "create_agent") {
    return null;
  }

  const authoritativePresentation = parentDurableSessionId
    ? deriveAuthoritativeAgentOperation(item, parentDurableSessionId, parentWorkspaceId)
    : null;
  return {
    key: item.itemId,
    item,
    sessionId: workspacePresentation.agent?.sessionId ?? null,
    workspaceId: workspacePresentation.agent?.workspaceId ?? null,
    title: workspacePresentation.agent?.title ?? readInputTitle(item) ?? "Subagent",
    pending: item.status === "in_progress",
    failed: item.status === "failed",
    historicalNavigationAuthorized: authoritativePresentation?.action === "create_agent",
  };
}

function creationResultText(item: ToolCallItem): string | null {
  const structuredOutput = readAgentOperationsOutput(item);
  if (structuredOutput) {
    try {
      return JSON.stringify(structuredOutput, null, 2);
    } catch {
      return null;
    }
  }
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
  const input = readAgentOperationsInput(item);
  if (!input) return null;
  for (const key of ["title", "label", "task"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function creationRunVerb(counts: {
  successfulCount: number;
  pendingCount: number;
  failedCount: number;
  unresolvedCount: number;
}): string {
  const parts = [
    counts.successfulCount > 0 ? "started working" : null,
    counts.pendingCount === 1
      ? "starting"
      : counts.pendingCount > 1
        ? `${counts.pendingCount} starting`
        : null,
    counts.failedCount === 1
      ? "failed to start"
      : counts.failedCount > 1
        ? `${counts.failedCount} failed to start`
        : null,
    counts.unresolvedCount > 0 ? "identity unavailable" : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}
