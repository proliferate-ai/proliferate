import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useWorkspaceStatusModel } from "@/hooks/workspaces/derived/use-workspace-status-model";
import {
  WorkspaceStatusComposerControl,
  type WorkspaceStatusActions,
} from "./WorkspaceStatusComposerControl";

/** The live workspace-status trigger + card: model from the session's git/PR,
 * delegated-work, and native-activity feeds; actions through the shell. */
export function ConnectedWorkspaceStatusComposerControl() {
  const { model, openAgentSession, compareUrl } = useWorkspaceStatusModel();
  const shellActions = useWorkspaceShellActions();
  const { openExternal } = useProductHost().links;

  const actions = useMemo<WorkspaceStatusActions>(() => ({
    onOpenChanges: shellActions
      ? () => shellActions.openRightPanelTool("git")
      : undefined,
    onCommitOrPush: shellActions
      ? () => shellActions.openPublishDialog("commit")
      : undefined,
    // Compare branch opens the provider's base...current compare page; the
    // publish-dialog PR flow is the fallback when there is no remote to link.
    onCompareBranch: compareUrl
      ? () => void openExternal(compareUrl)
      : shellActions?.openPullRequest,
    // "View" on the checks row opens the PR itself (ruled 2026-07-14).
    onViewChecks: shellActions?.openPullRequest,
    onOpenAgentSession: openAgentSession ?? undefined,
  }), [compareUrl, openAgentSession, openExternal, shellActions]);

  if (!model) {
    return null;
  }

  return <WorkspaceStatusComposerControl model={model} actions={actions} />;
}
