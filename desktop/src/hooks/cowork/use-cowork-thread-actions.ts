import { useCreateCoworkWorkspaceMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useCoworkWorkspaces } from "@/hooks/cowork/use-cowork-workspaces";
import { resolveCoworkCreateSelection } from "@/lib/domain/cowork/launch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useCoworkThreadActions() {
  const showToast = useToastStore((state) => state.show);
  const createCoworkWorkspace = useCreateCoworkWorkspaceMutation();
  const { selectSession } = useSessionActions();
  const { selectWorkspace } = useWorkspaceSelection();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
  })));
  const { readyAgents } = useAgentCatalog();
  const coworkWorkspaces = useCoworkWorkspaces().data;
  const setPendingCoworkThread = useAppSurfaceStore(
    (state) => state.setPendingCoworkThread,
  );

  const createThread = useCallback(async () => {
    try {
      const selection = resolveCoworkCreateSelection(readyAgents, preferences);
      if (!selection) {
        showToast("No ready agents are available for Cowork.");
        return null;
      }

      const tempId = `pending-${Date.now()}`;
      setPendingCoworkThread({ tempId });

      const created = await createCoworkWorkspace.mutateAsync({
        agentKind: selection.agentKind,
        modelId: selection.modelId,
      });
      await selectWorkspace(created.workspace.id, { force: true, preservePending: true });
      await selectSession(created.session.id, { allowColdIdleNoStream: true });
      setPendingCoworkThread(null);
      return created;
    } catch (error) {
      setPendingCoworkThread(null);
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to create Cowork thread: ${message}`);
      return null;
    }
  }, [
    createCoworkWorkspace,
    preferences,
    readyAgents,
    selectSession,
    selectWorkspace,
    setPendingCoworkThread,
    showToast,
  ]);

  const selectThread = useCallback(async (workspaceId: string) => {
    try {
      await selectWorkspace(workspaceId, { force: true });
      const workspace = coworkWorkspaces.find((candidate) => candidate.id === workspaceId) ?? null;
      if (workspace?.defaultSessionId) {
        await selectSession(workspace.defaultSessionId, { allowColdIdleNoStream: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to open Cowork thread: ${message}`);
    }
  }, [
    coworkWorkspaces,
    selectSession,
    selectWorkspace,
    showToast,
  ]);

  return {
    createThread,
    selectThread,
    isCreatingThread: createCoworkWorkspace.isPending,
  };
}
