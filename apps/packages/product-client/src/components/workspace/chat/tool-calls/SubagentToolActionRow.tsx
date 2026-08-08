import { AgentChip, AgentChipVerb } from "#product/components/workspace/delegated-work/AgentChip";
import { DelegatedAgentHoverCard } from "#product/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import {
  useTranscriptOpenSession,
  useTranscriptWorkspaceId,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { useWorkspaceNameResolver } from "#product/hooks/workspaces/derived/use-workspace-name";
import type {
  SubagentMcpReceiptPresentation,
} from "#product/domain/chats/subagents/subagent-tool-presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "#product/lib/domain/delegated-work/presentation";
import type { ToolActionStatus } from "./ToolActionRow";

/**
 * An agent-ops receipt in the transcript: chip + one quiet verb (ADR §4).
 *
 * This is the sending side, so it sits on the LEFT — the agent acting. Anything
 * arriving FROM an agent lands right (SubagentWakeBadge). The message body
 * never gets its own UI: hovering the chip shows the literal message, and
 * clicking it opens the thread.
 */
export function SubagentToolActionRow({
  presentation,
  status,
}: {
  presentation: SubagentMcpReceiptPresentation;
  status: ToolActionStatus;
}) {
  const openSession = useTranscriptOpenSession();
  const transcriptWorkspaceId = useTranscriptWorkspaceId();
  const targetSessionId = presentation.childSessionId?.trim() || null;
  const canOpenSession =
    presentation.openSessionAllowed && !!targetSessionId && !!openSession;
  const identity = buildDelegatedAgentIdentity({
    id:
      presentation.sessionLinkId
      ?? presentation.subagentId
      ?? presentation.childSessionId
      ?? presentation.title,
    title: presentation.title,
    sessionId: presentation.childSessionId,
    sessionLinkId: presentation.sessionLinkId,
  });
  const failed = status === "failed";
  const hoverAgent = {
    identity,
    kind: "subagent" as const,
    originLabel: presentation.originLabel,
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel: presentation.detailLabel ?? presentation.statusLabel,
      wakeScheduled: presentation.wakeScheduled,
    }),
    statusLabel: presentation.detailLabel ?? presentation.statusLabel ?? "Updated",
    parentTitle: null,
    hoverTitle: [
      identity.displayName,
      presentation.originLabel,
      presentation.detailLabel ?? presentation.statusLabel,
    ].filter((value): value is string => !!value).join("\n"),
  };

  const openTarget = () => {
    if (canOpenSession && targetSessionId) {
      openSession(targetSessionId, "linked-child");
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-message" data-subagent-receipt>
      <DelegatedAgentHoverCard
        agent={hoverAgent}
        message={presentation.messageText}
        cardAriaLabel={`Open ${identity.displayName}`}
        onCardClick={canOpenSession ? openTarget : undefined}
      >
        <AgentChip
          identity={identity}
          dimmed={presentation.action === "close" && !presentation.openSessionAllowed}
          showShortId={presentation.addressedById}
          onOpen={canOpenSession ? openTarget : undefined}
        />
      </DelegatedAgentHoverCard>
      <AgentChipVerb className={failed ? "text-destructive/80" : ""}>
        {failed ? `${presentation.chipVerb} — failed` : presentation.chipVerb}
        {/* Facts the verb cannot carry ("2 events", "Working") trail it as a
            faint suffix, the same idiom the workspace receipts use. Never a
            second verb, and never the message body. */}
        {presentation.detailLabel && presentation.action !== "close" && (
          <span className="text-muted-foreground/70">{` — ${presentation.detailLabel}`}</span>
        )}
        {/* A peer spawned ELSEWHERE carries its workspace, per the Workspace Ops
            canvas page: "<chip> — in billing-hotfix-dispatch". ADR §4 scopes
            that to the cross-workspace case, so a spawn into this transcript's
            own workspace says nothing: the reader is already there. */}
        {presentation.workspaceId && presentation.workspaceId !== transcriptWorkspaceId && (
          <AgentWorkspaceSuffix workspaceId={presentation.workspaceId} />
        )}
      </AgentChipVerb>
    </div>
  );
}

/**
 * Resolves the receipt's workspace id to the name the human already knows.
 * It is its own component so the workspace-collection read only happens for the
 * receipts that name a workspace — every other receipt stays a leaf.
 */
function AgentWorkspaceSuffix({ workspaceId }: { workspaceId: string }) {
  const resolveWorkspaceName = useWorkspaceNameResolver();
  const workspaceName = resolveWorkspaceName(workspaceId);
  if (!workspaceName) {
    return null;
  }
  return <span className="text-muted-foreground/70">{` — in ${workspaceName}`}</span>;
}
