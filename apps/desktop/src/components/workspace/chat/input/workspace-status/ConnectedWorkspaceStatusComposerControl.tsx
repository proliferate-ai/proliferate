import { useMemo } from "react";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useWorkspaceStatusModel } from "@/hooks/workspaces/derived/use-workspace-status-model";
import {
  WorkspaceStatusComposerControl,
  type WorkspaceStatusActions,
} from "./WorkspaceStatusComposerControl";

/** The live workspace-status trigger + card: model from the session's git/PR,
 * delegated-work, and native-activity feeds; actions through the shell. */
export function ConnectedWorkspaceStatusComposerControl() {
  const { model, openAgentSession } = useWorkspaceStatusModel();
  const shellActions = useWorkspaceShellActions();

  const actions = useMemo<WorkspaceStatusActions>(() => ({
    onOpenChanges: shellActions
      ? () => shellActions.openRightPanelTool("git")
      : undefined,
    onCommitOrPush: shellActions
      ? () => shellActions.openPublishDialog("commit")
      : undefined,
    onCompareBranch: shellActions?.openPullRequest,
    // "View" on the checks row opens the PR itself (ruled 2026-07-14).
    onViewChecks: shellActions?.openPullRequest,
    onOpenAgentSession: openAgentSession ?? undefined,
  }), [openAgentSession, shellActions]);

  if (!model) {
    return null;
  }

  return <WorkspaceStatusComposerControl model={model} actions={actions} />;
}
