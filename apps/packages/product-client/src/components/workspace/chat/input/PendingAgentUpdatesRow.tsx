import { Button } from "#product/primitives/Button";
import { Tooltip } from "#product/primitives/Tooltip";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import type {
  PendingPromptQueueAgent,
  PendingPromptQueueRow,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

export function PendingAgentUpdatesRow({
  entry,
  onOpenAgent,
  canOpenAgent,
  directoryBackedAgentNavigation,
}: {
  entry: PendingPromptQueueRow;
  onOpenAgent?: (sessionId: string) => void;
  canOpenAgent?: (sessionId: string) => boolean;
  directoryBackedAgentNavigation: boolean;
}) {
  return (
    <div
      data-pending-agent-updates
      className="flex items-center justify-between gap-2 py-0.5 pl-4"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-ui text-muted-foreground">
        <span>{entry.label}</span>
        <span className="flex items-center -space-x-1.5" data-pending-agent-glyphs>
          {entry.agents.map((agent) => directoryBackedAgentNavigation ? (
            <ConnectedPendingAgentIdentityGlyph key={agent.sessionId} agent={agent} />
          ) : (
            <PendingAgentIdentityGlyph
              key={agent.sessionId}
              agent={agent}
              canOpen={Boolean(
                onOpenAgent
                && (canOpenAgent?.(agent.sessionId) ?? true),
              )}
              onOpen={onOpenAgent ? () => onOpenAgent(agent.sessionId) : undefined}
            />
          ))}
        </span>
        <span className="text-ui-sm text-faint">
          {entry.agentUpdateCount} {entry.agentUpdateCount === 1 ? "update" : "updates"}
        </span>
      </span>
      <span className="shrink-0 text-ui-sm text-faint">delivered next turn</span>
    </div>
  );
}

function ConnectedPendingAgentIdentityGlyph({
  agent,
}: {
  agent: PendingPromptQueueAgent;
}) {
  const navigationSessionId = useSessionDirectoryStore((state) =>
    state.clientSessionIdByMaterializedSessionId[agent.sessionId] ?? agent.sessionId
  );
  const navigationWorkspaceId = useSessionDirectoryStore(
    (state) => state.entriesById[navigationSessionId]?.workspaceId ?? null,
  );
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const canOpen = navigationWorkspaceId !== null;

  return (
    <PendingAgentIdentityGlyph
      agent={agent}
      canOpen={canOpen}
      onOpen={canOpen
        ? () => {
          void openWorkspaceSession({
            workspaceId: navigationWorkspaceId,
            sessionId: navigationSessionId,
          });
        }
        : undefined}
    />
  );
}

function PendingAgentIdentityGlyph({
  agent,
  canOpen,
  onOpen,
}: {
  agent: PendingPromptQueueAgent;
  canOpen: boolean;
  onOpen?: () => void;
}) {
  const identity = buildDelegatedAgentIdentity({
    id: agent.sessionId,
    title: agent.title,
    sessionId: agent.sessionId,
  });
  const queuedLabel = `${agent.title} · ${agent.updateCount} queued ${
    agent.updateCount === 1 ? "update" : "updates"
  }${canOpen ? " — click to open" : ""}`;
  const glyph = <AgentIdentityGlyph identity={identity} dimension={14} />;

  return (
    <Tooltip content={queuedLabel}>
      {canOpen && onOpen ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-pending-agent-glyph={agent.sessionId}
          className="relative flex size-5 items-center justify-center rounded-full bg-surface-elevated ring-1 ring-border transition-transform hover:z-raised hover:scale-110 focus-visible:z-raised focus-visible:scale-110 focus-visible:ring-ring"
          aria-label={`Open ${identity.displayName}`}
          onClick={onOpen}
        >
          {glyph}
        </Button>
      ) : (
        <span
          data-pending-agent-glyph={agent.sessionId}
          data-agent-navigation-unresolved
          className="relative flex size-5 items-center justify-center rounded-full bg-surface-elevated ring-1 ring-border"
          aria-label={identity.displayName}
        >
          {glyph}
        </span>
      )}
    </Tooltip>
  );
}
