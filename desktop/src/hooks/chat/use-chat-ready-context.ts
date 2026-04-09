import { useMemo } from "react";
import { getProviderDisplayName } from "@/config/providers";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { resolveModelDisplayName } from "@/lib/domain/chat/model-display";
import { workspaceBranchLabel, workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";

export interface ChatReadyContext {
  workspaceName: string | null;
  branchLabel: string | null;
  agentDisplayName: string | null;
  modelDisplayName: string | null;
}

/**
 * Display strings for the ready hero's context line. Reads workspace from
 * the workspaces query and agent/model from the active session slot. Each
 * field can be null and the renderer drops nulls from the joined line.
 */
export function useChatReadyContext(): ChatReadyContext {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const agentKind = useHarnessStore((state) =>
    state.activeSessionId
      ? state.sessionSlots[state.activeSessionId]?.agentKind ?? null
      : null,
  );
  const modelId = useHarnessStore((state) =>
    state.activeSessionId
      ? state.sessionSlots[state.activeSessionId]?.modelId ?? null
      : null,
  );
  const liveConfigModelLabel = useHarnessStore((state) => {
    if (!state.activeSessionId) return null;
    const slot = state.sessionSlots[state.activeSessionId];
    const control = slot?.liveConfig?.normalizedControls.model;
    if (!control) return null;
    return (
      control.values.find((value) => value.value === control.currentValue)?.label
      ?? null
    );
  });
  const { data: workspaceCollections } = useWorkspaces();

  return useMemo(() => {
    const workspace = selectedWorkspaceId
      ? workspaceCollections?.workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ?? null
      : null;

    const workspaceName = workspace ? workspaceDisplayName(workspace) : null;
    const branchLabelRaw = workspace ? workspaceBranchLabel(workspace) : null;
    // Avoid duplicating the workspace name in the context line when the
    // workspace's display name is already its branch (worktree case).
    const branchLabel = branchLabelRaw && branchLabelRaw !== workspaceName ? branchLabelRaw : null;

    const agentDisplayName = agentKind ? getProviderDisplayName(agentKind) : null;
    const modelDisplayName = agentKind && modelId
      ? resolveModelDisplayName({
        agentKind,
        modelId,
        sourceLabels: [liveConfigModelLabel],
      })
      : null;

    return {
      workspaceName,
      branchLabel,
      agentDisplayName,
      modelDisplayName,
    };
  }, [
    agentKind,
    liveConfigModelLabel,
    modelId,
    selectedWorkspaceId,
    workspaceCollections,
  ]);
}
