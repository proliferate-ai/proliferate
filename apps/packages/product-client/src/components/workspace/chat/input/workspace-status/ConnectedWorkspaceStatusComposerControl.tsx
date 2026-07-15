import { useMemo, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useWorkspaceStatusModel } from "#product/hooks/workspaces/derived/use-workspace-status-model";
import { useRuntimePressureControlState } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { RuntimePressureDetailsDialog } from "#product/components/workspace/chat/input/RuntimePressureDetailsDialog";
import {
  WorkspaceStatusComposerControl,
  type WorkspaceStatusActions,
} from "./WorkspaceStatusComposerControl";

/** The live workspace-status trigger + card: model from the session's git/PR,
 * delegated-work, and native-activity feeds; runtime resources from the
 * pressure facade (Resources section + worktrees modal); advanced session
 * config from the composer's overflow group; actions through the shell. */
export function ConnectedWorkspaceStatusComposerControl({
  advancedControls = [],
  agentKind = null,
}: {
  advancedControls?: LiveSessionControlDescriptor[];
  agentKind?: string | null;
}) {
  const { model, openAgentSession, compareUrl } = useWorkspaceStatusModel();
  const shellActions = useWorkspaceShellActions();
  const { openExternal } = useProductHost().links;
  const pressure = useRuntimePressureControlState();
  const [worktreesOpen, setWorktreesOpen] = useState(false);

  const environmentState = pressure.visible ? pressure.indicator : null;

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

  return (
    <>
      <WorkspaceStatusComposerControl
        model={model}
        actions={actions}
        environmentState={environmentState}
        onOpenWorktrees={environmentState ? () => setWorktreesOpen(true) : undefined}
        advancedControls={advancedControls}
        agentKind={agentKind}
      />
      {environmentState && (
        <RuntimePressureDetailsDialog
          open={worktreesOpen}
          targetState={environmentState}
          actions={pressure.actions}
          onClose={() => setWorktreesOpen(false)}
        />
      )}
    </>
  );
}
