import { ArrowLeft, CircleAlert, RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChatSurfaceCard } from "#product/components/workspace/chat/surface/ChatSurfaceCard";
import {
  WORKSPACE_SESSION_RECOVERY_BODY,
  WORKSPACE_SESSION_RECOVERY_TITLE,
} from "#product/copy/workspaces/workspace-session-recovery-copy";
import type {
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";

const RECOVERY_TITLE_ID = "workspace-session-recovery-title";

export function WorkspaceSessionRecoveryCard({
  bottomInsetPx,
  isRetrying,
  onBackToWorkspaces,
  onReload,
  onRetry,
  reason,
}: {
  bottomInsetPx: number;
  isRetrying: boolean;
  onBackToWorkspaces: () => void;
  onReload: () => void;
  onRetry: () => void;
  reason: WorkspaceSessionRecoveryReason;
}) {
  return (
    <ChatSurfaceCard
      badge="Workspace recovery"
      bottomInsetPx={bottomInsetPx}
      title={WORKSPACE_SESSION_RECOVERY_TITLE}
      description={WORKSPACE_SESSION_RECOVERY_BODY[reason]}
      icon={<CircleAlert className="size-6 text-warning-foreground" />}
      surfaceId="workspace-session-recovery"
      surfaceRole="alert"
      surfaceLabelledBy={RECOVERY_TITLE_ID}
      titleId={RECOVERY_TITLE_ID}
      actions={(
        <>
          <Button
            type="button"
            autoFocus
            variant="primary"
            size="sm"
            loading={isRetrying}
            onClick={onRetry}
          >
            {!isRetrying && <RefreshCw className="size-3.5" />}
            Retry
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onReload}>
            Reload
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBackToWorkspaces}>
            <ArrowLeft className="size-3.5" />
            Back to workspaces
          </Button>
        </>
      )}
    />
  );
}
