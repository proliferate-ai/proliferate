import { useMemo } from "react";
import { getProviderDisplayName } from "@/config/providers";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";
import { workspaceBranchLabel, workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { useChatLaunchProjection } from "./use-chat-launch-projection";

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
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
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
    return resolveMatchingModelControlLabel({
      modelId: slot?.modelId,
      control,
    });
  });
  const { data: workspaceCollections } = useWorkspaces();
  const projection = useChatLaunchProjection();

  return useMemo(() => {
    const workspace = selectedWorkspaceId
      ? workspaceCollections?.workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ?? null
      : null;

    const workspaceName = workspace
      ? workspaceDisplayName(workspace)
      : pendingWorkspaceEntry?.displayName ?? null;
    const branchLabelRaw = workspace
      ? workspaceBranchLabel(workspace)
      : pendingWorkspaceEntry?.baseBranchName ?? null;
    // Avoid duplicating the workspace name in the context line when the
    // workspace's display name is already its branch (worktree case).
    const branchLabel = branchLabelRaw && branchLabelRaw !== workspaceName ? branchLabelRaw : null;

    const effectiveAgentKind = agentKind ?? projection?.agentKind ?? null;
    const effectiveModelId = modelId ?? projection?.modelId ?? null;
    const agentDisplayName = effectiveAgentKind ? getProviderDisplayName(effectiveAgentKind) : null;
    const modelDisplayName = effectiveAgentKind && effectiveModelId
      ? resolveModelDisplayName({
        agentKind: effectiveAgentKind,
        modelId: effectiveModelId,
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
    pendingWorkspaceEntry,
    projection,
    selectedWorkspaceId,
    workspaceCollections,
  ]);
}
