import { Button } from "#product/primitives/Button";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import { AgentIdentityChip } from "#product/components/workspace/chat/transcript/AgentIdentityChip";
import type { AgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

export function AgentOperationsWorkspaceReceipt({
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

export function AgentOperationsLifecycleReceipt({
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
