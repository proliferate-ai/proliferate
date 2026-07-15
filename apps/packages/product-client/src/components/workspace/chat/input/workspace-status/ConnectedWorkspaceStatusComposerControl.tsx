import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useWorkspaceStatusModel } from "#product/hooks/workspaces/derived/use-workspace-status-model";
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

  const compareOpensPr = model?.environment?.compareOpensPr ?? false;
  const actions = useMemo<WorkspaceStatusActions>(() => ({
    onOpenChanges: shellActions
      ? () => shellActions.openRightPanelTool("git")
      : undefined,
    onCommitOrPush: shellActions
      ? () => shellActions.openPublishDialog("commit")
      : undefined,
    // "View PR" opens the PR itself; without a PR, Compare branch opens the
    // provider's base...current compare page (window.open covers browser dev
    // where the tauri open_external command is unavailable). With neither,
    // the row is dimmed — never the publish modal.
    onCompareBranch: compareOpensPr
      ? shellActions?.openPullRequest
      : compareUrl
        ? () => {
          void openExternal(compareUrl).catch(() => {
            window.open(compareUrl, "_blank", "noopener,noreferrer");
          });
        }
        : undefined,
    // "View" on the checks row opens the PR itself (ruled 2026-07-14).
    onViewChecks: shellActions?.openPullRequest,
    onOpenAgentSession: openAgentSession ?? undefined,
  }), [compareOpensPr, compareUrl, openAgentSession, openExternal, shellActions]);

  if (!model) {
    return null;
  }

  return <WorkspaceStatusComposerControl model={model} actions={actions} />;
}
