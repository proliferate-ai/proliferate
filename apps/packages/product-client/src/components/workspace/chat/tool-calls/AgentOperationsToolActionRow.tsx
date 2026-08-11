import { useMemo, useState } from "react";
import { Button } from "#product/primitives/Button";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import { AgentIdentityChip } from "#product/components/workspace/chat/transcript/AgentIdentityChip";
import { AgentMessageReceipt } from "#product/components/workspace/chat/transcript/AgentMessageReceipt";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import type { AgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";

export function AgentOperationsToolActionRow({
  presentation,
  resultText,
  currentWorkspaceId,
}: {
  presentation: AgentOperationsReceiptPresentation;
  resultText?: string | null;
  currentWorkspaceId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const openSession = useTranscriptOpenSession();
  const canOpenSession = useTranscriptCanOpenSession();
  const { selectWorkspace } = useWorkspaceSelection();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { data: workspaceCollections } = useWorkspaces({ enabled: false });
  const targetSessionId = presentation.agent?.sessionId ?? null;
  const directoryAgent = useSessionDirectoryStore((state) => {
    if (!targetSessionId) {
      return null;
    }
    const clientSessionId =
      state.clientSessionIdByMaterializedSessionId[targetSessionId] ?? targetSessionId;
    return state.entriesById[clientSessionId] ?? null;
  });
  const resolvedAgentTitle = presentation.agent?.title?.trim()
    || directoryAgent?.title
    || directoryAgent?.activity.transcriptTitle
    || "Agent";
  const identity = useMemo(() => {
    const agent = presentation.agent;
    if (!agent) {
      return null;
    }
    return buildDelegatedAgentIdentity({
      id: agent.sessionId ?? presentation.targetAgentId ?? agent.title ?? "agent",
      title: resolvedAgentTitle,
      workspaceId: agent.workspaceId ?? directoryAgent?.workspaceId ?? null,
      sessionId: agent.sessionId,
    });
  }, [directoryAgent?.workspaceId, presentation.agent, presentation.targetAgentId, resolvedAgentTitle]);
  const openRole: TranscriptOpenSessionRole = presentation.action === "promote_subagent"
    || presentation.agent?.role === "ordinary"
    || directoryAgent?.sessionRelationship.kind === "root"
      ? "generic"
      : "linked-child";
  const legacySendWorkspaceId = presentation.source === "legacy_subagents"
    && presentation.action === "send_message"
      ? currentWorkspaceId
      : null;
  const navigationWorkspaceId = presentation.agent?.workspaceId
    ?? directoryAgent?.workspaceId
    ?? legacySendWorkspaceId;
  const navigationSessionId = directoryAgent?.sessionId ?? targetSessionId;
  const isCurrentWorkspace = navigationWorkspaceId !== null
    && navigationWorkspaceId === currentWorkspaceId;
  const isProjectedWorkspace = navigationWorkspaceId !== null
    && Boolean(
      workspaceCollections?.allWorkspaces.some(
        (workspace) => workspace.id === navigationWorkspaceId,
      ),
    );
  const usesTranscriptNavigation = Boolean(
    openSession
    && (
      isCurrentWorkspace
      || (legacySendWorkspaceId && !presentation.agent?.workspaceId && !directoryAgent)
    )
    && (canOpenSession?.(navigationSessionId ?? "", openRole) ?? true),
  );
  const hasAuthoritativeNavigation = navigationWorkspaceId !== null
    && Boolean(
      isCurrentWorkspace
      || directoryAgent
      || legacySendWorkspaceId
      || (presentation.agent?.workspaceId && isProjectedWorkspace),
  );
  const canOpenAgent = Boolean(
    navigationSessionId
    && hasAuthoritativeNavigation
    && (usesTranscriptNavigation || navigationWorkspaceId),
  );
  const openAgent = canOpenAgent && navigationSessionId
    ? usesTranscriptNavigation
      ? () => openSession?.(navigationSessionId, openRole)
      : navigationWorkspaceId
        ? () => {
          void openWorkspaceSession({
            workspaceId: navigationWorkspaceId,
            sessionId: navigationSessionId,
          });
        }
        : undefined
    : undefined;
  const toggleDetails = resultText ? () => setExpanded((value) => !value) : undefined;

  const receipt = presentation.action === "send_message" ? (
    <AgentMessageReceipt
      direction="outgoing"
      identity={identity}
      fallbackLabel={resolvedAgentTitle}
      verb={presentation.isRunning ? "messaging" : presentation.isFailed ? "message failed" : "messaged"}
      exactMessage={presentation.message}
      onOpen={openAgent}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  ) : presentation.action === "create_workspace" ? (
    <WorkspaceReceipt
      presentation={presentation}
      onOpen={presentation.workspace?.workspaceId
        ? () => {
          const workspace = presentation.workspace!;
          void selectWorkspace(workspace.workspaceId!, {
            force: true,
            knownWorkspace: workspace.knownWorkspace,
          });
        }
        : undefined}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  ) : (
    <LifecycleReceipt
      presentation={presentation}
      identity={identity}
      resolvedAgentTitle={resolvedAgentTitle}
      onOpen={openAgent}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  );

  return (
    <div>
      {receipt}
      {expanded && resultText ? (
        <div className="mt-1.5">
          <ToolActionDetailsPanel>
            <AutoHideScrollArea
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            >
              <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-readable-code text-muted-foreground">
                {resultText}
              </pre>
            </AutoHideScrollArea>
          </ToolActionDetailsPanel>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceReceipt({
  presentation,
  onOpen,
  onToggleDetails,
  detailsExpanded,
}: {
  presentation: AgentOperationsReceiptPresentation;
  onOpen?: () => void;
  onToggleDetails?: () => void;
  detailsExpanded: boolean;
}) {
  const workspace = presentation.workspace;
  return (
    <div
      data-agent-operations-receipt="create_workspace"
      className={`flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-chat ${
        presentation.isFailed ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
    >
      {onToggleDetails ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          className="inline-flex shrink-0 items-center gap-1 text-chat hover:text-foreground focus-visible:text-foreground focus-visible:underline"
          aria-label={detailsExpanded ? "Hide agent operation details" : "Show agent operation details"}
          aria-expanded={detailsExpanded}
          onClick={onToggleDetails}
        >
          <ProliferateIcon className="icon-compact shrink-0 text-faint [font-size:var(--text-chat)]" />
          <span>{presentation.actionLabel}</span>
        </Button>
      ) : (
        <>
          <ProliferateIcon className="icon-compact shrink-0 text-faint [font-size:var(--text-chat)]" />
          <span className="shrink-0">{presentation.actionLabel}</span>
        </>
      )}
      {workspace ? (
        <>
          <span className="min-w-0 truncate font-medium text-foreground/80">
            {workspace.displayName}
          </span>
          {presentation.detailLabel ? (
            <span className="min-w-0 truncate text-muted-foreground/70">
              — {presentation.detailLabel} ·
            </span>
          ) : null}
          {workspace.workspaceId && onOpen ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              data-chat-transcript-ignore
              className="shrink-0 text-chat text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
              onClick={onOpen}
            >
              Open
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LifecycleReceipt({
  presentation,
  identity,
  resolvedAgentTitle,
  onOpen,
  onToggleDetails,
  detailsExpanded,
}: {
  presentation: AgentOperationsReceiptPresentation;
  identity: ReturnType<typeof buildDelegatedAgentIdentity> | null;
  resolvedAgentTitle: string;
  onOpen?: () => void;
  onToggleDetails?: () => void;
  detailsExpanded: boolean;
}) {
  const lifecycleClosed = !presentation.isRunning
    && !presentation.isFailed
    && (presentation.action === "close_subagent" || presentation.agent?.closed === true);
  const hasAttributedAgent = Boolean(identity?.sessionId || presentation.agent);
  const verb = hasAttributedAgent
    ? lifecycleReceiptVerb(presentation)
    : presentation.actionLabel;
  return (
    <div
      data-agent-operations-receipt={presentation.action}
      className={`flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-chat ${
        presentation.isFailed ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
    >
      {identity?.sessionId ? (
        <AgentIdentityChip identity={identity} closed={lifecycleClosed} onOpen={onOpen} />
      ) : presentation.agent ? (
        <span className="min-w-0 truncate font-medium text-foreground/80">
          {resolvedAgentTitle}
        </span>
      ) : null}
      {onToggleDetails ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          className="shrink-0 text-chat hover:text-foreground focus-visible:text-foreground focus-visible:underline"
          aria-label={detailsExpanded ? "Hide agent operation details" : "Show agent operation details"}
          aria-expanded={detailsExpanded}
          onClick={onToggleDetails}
        >
          {verb}
        </Button>
      ) : (
        <span className="shrink-0">{verb}</span>
      )}
      {presentation.detailLabel ? (
        <span className="min-w-0 truncate text-muted-foreground/70">
          — {presentation.detailLabel}
        </span>
      ) : null}
    </div>
  );
}

function lifecycleReceiptVerb(
  presentation: AgentOperationsReceiptPresentation,
): string {
  if (presentation.isRunning) {
    switch (presentation.action) {
      case "create_agent": return "creating";
      case "configure_agent": return "configuring";
      case "resume_agent": return "resuming";
      case "interrupt_agent": return "interrupting";
      case "close_subagent": return "closing";
      case "open_subagent": return "opening";
      case "promote_subagent": return "promoting";
      default: return presentation.actionLabel;
    }
  }
  if (presentation.isFailed) {
    switch (presentation.action) {
      case "create_agent": return "failed to create";
      case "configure_agent": return "failed to configure";
      case "resume_agent": return "failed to resume";
      case "interrupt_agent": return "failed to interrupt";
      case "close_subagent": return "failed to close";
      case "open_subagent": return "failed to open";
      case "promote_subagent": return "failed to promote";
      default: return presentation.actionLabel;
    }
  }
  switch (presentation.action) {
    case "create_agent": return "created";
    case "configure_agent": return "configured";
    case "resume_agent": return "resumed";
    case "interrupt_agent": return "interrupted";
    case "close_subagent": return "closed";
    case "open_subagent": return "opened";
    case "promote_subagent": return "promoted";
    default: return presentation.actionLabel;
  }
}
