import { WorkspaceSessionRecoveryCard } from "#product/components/workspace/chat/surface/WorkspaceSessionRecoveryCard";
import { useWorkspaceSessionRecoveryActions } from "#product/hooks/workspaces/workflows/use-workspace-session-recovery-actions";
import type {
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";

export function WorkspaceSessionRecoveryState({
  bottomInsetPx,
  reason,
}: {
  bottomInsetPx: number;
  reason: WorkspaceSessionRecoveryReason;
}) {
  const actions = useWorkspaceSessionRecoveryActions();
  return (
    <WorkspaceSessionRecoveryCard
      bottomInsetPx={bottomInsetPx}
      reason={reason}
      isRetrying={actions.isRetrying}
      onRetry={() => void actions.retry()}
      onReload={actions.reload}
      onBackToWorkspaces={actions.backToWorkspaces}
    />
  );
}
