import { Button } from "#product/primitives/Button";
import { GitBranch } from "#product/primitives/icons/workspace-git";
import { useTranscriptOpenWorkspace } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import type {
  WorkspaceOpsReceiptPresentation,
} from "#product/domain/chats/subagents/workspace-ops-presentation";

/**
 * An agent creating a workspace, as one transcript line (ADR §4, Workspace Ops
 * canvas page, locked option 1a):
 *
 *   Created workspace billing-hotfix-dispatch — proliferate · worktree from main · Open
 *
 * Same weight as every other quiet tool receipt: no card, no artifact
 * treatment. Open switches to that workspace.
 */
export function WorkspaceOpsReceiptRow({
  presentation,
}: {
  presentation: WorkspaceOpsReceiptPresentation;
}) {
  const verb = presentation.failed
    ? "Could not create workspace"
    : presentation.running
      ? "Creating workspace"
      : "Created workspace";

  return (
    <div
      className={`flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-chat ${
        presentation.failed ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
      data-workspace-ops-receipt
    >
      <GitBranch aria-hidden="true" className="icon-compact shrink-0 text-faint" />
      <span className="shrink-0">{verb}</span>
      <span className="min-w-0 truncate font-medium text-foreground/80">{presentation.name}</span>
      {presentation.provenanceLabel && (
        <span className="min-w-0 truncate text-muted-foreground/70">
          {` — ${presentation.provenanceLabel}`}
        </span>
      )}
      {presentation.runScript && (
        <span className="min-w-0 truncate text-muted-foreground/70">
          {" · run script → "}
          <span className="font-mono">{presentation.runScript}</span>
        </span>
      )}
      {presentation.workspaceId && !presentation.failed && !presentation.running && (
        <OpenWorkspaceAction
          workspaceId={presentation.workspaceId}
          workspaceName={presentation.name}
        />
      )}
    </div>
  );
}

function OpenWorkspaceAction({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const openWorkspace = useTranscriptOpenWorkspace();
  if (!openWorkspace) {
    return null;
  }
  return (
    <>
      <span className="shrink-0 text-muted-foreground/70">·</span>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-chat-transcript-ignore
        className="shrink-0 text-link-foreground hover:underline focus-visible:underline"
        aria-label={`Open ${workspaceName}`}
        onClick={() => openWorkspace(workspaceId)}
      >
        Open
      </Button>
    </>
  );
}
