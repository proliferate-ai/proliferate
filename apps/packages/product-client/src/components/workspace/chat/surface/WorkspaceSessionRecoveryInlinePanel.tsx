import { CircleAlert, RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { useNavigate } from "react-router-dom";
import {
  ComposerAttachedPanel,
} from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import {
  WORKSPACE_SESSION_INLINE_RECOVERY_BODY,
  WORKSPACE_SESSION_INLINE_RECOVERY_TITLE,
} from "#product/copy/workspaces/workspace-session-inline-recovery-copy";
import { useWorkspaceSessionRecoveryActions } from "#product/hooks/workspaces/workflows/use-workspace-session-recovery-actions";
import type {
  WorkspaceSessionRecovery,
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";

const RECOVERY_TITLE_ID = "workspace-session-inline-recovery-title";
const RECOVERY_BODY_ID = "workspace-session-inline-recovery-body";

export function WorkspaceSessionRecoveryInlinePanel({
  recovery,
}: {
  recovery: WorkspaceSessionRecovery;
}) {
  const actions = useWorkspaceSessionRecoveryActions();
  const navigate = useNavigate();
  if (actions.recovery?.sessionId !== recovery.sessionId) {
    return null;
  }
  return (
    <WorkspaceSessionRecoveryInlinePanelView
      isRetrying={actions.isRetrying}
      reason={recovery.reason}
      onConfigure={() => navigate(buildSettingsHref({ section: "agent-claude" }))}
      onRetry={() => void actions.retry()}
    />
  );
}

export function WorkspaceSessionRecoveryInlinePanelView({
  isRetrying,
  onRetry,
  onConfigure,
  reason,
}: {
  isRetrying: boolean;
  onConfigure?: () => void;
  onRetry: () => void;
  reason: WorkspaceSessionRecoveryReason;
}) {
  return (
    <ComposerAttachedPanel
      icon={<CircleAlert className="text-warning-foreground" />}
      title={(
        <span id={RECOVERY_TITLE_ID}>
          {WORKSPACE_SESSION_INLINE_RECOVERY_TITLE}
        </span>
      )}
    >
      <div
        role="alert"
        aria-labelledby={RECOVERY_TITLE_ID}
        aria-describedby={RECOVERY_BODY_ID}
        className="px-3 pb-3"
        data-workspace-session-recovery="inline"
      >
        <p id={RECOVERY_BODY_ID} className="text-base leading-5 text-muted-foreground">
          {WORKSPACE_SESSION_INLINE_RECOVERY_BODY[reason]}
        </p>
        <div className="mt-2 flex justify-end">
          {reason === "launch-configuration-unavailable" && onConfigure && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onConfigure}
            >
              Agent settings
            </Button>
          )}
          <Button
            type="button"
            autoFocus
            size="sm"
            loading={isRetrying}
            onClick={onRetry}
          >
            {!isRetrying && <RefreshCw className="size-3.5" />}
            Retry
          </Button>
        </div>
      </div>
    </ComposerAttachedPanel>
  );
}
