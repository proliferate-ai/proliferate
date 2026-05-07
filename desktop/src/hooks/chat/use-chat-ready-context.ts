import { useMemo } from "react";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";
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
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const agentKind = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.agentKind ?? null : null
  );
  const modelId = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.modelId ?? null : null
  );
  const liveConfigModelLabel = useSessionDirectoryStore((state) => {
    if (!activeSessionId) return null;
    const entry = state.entriesById[activeSessionId];
    const control = entry?.liveConfig?.normalizedControls.model;
    return resolveMatchingModelControlLabel({
      modelId: entry?.modelId,
      control,
    });
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
        preferKnownAlias: true,
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
