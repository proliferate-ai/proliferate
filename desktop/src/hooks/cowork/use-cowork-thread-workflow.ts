import { useModelRegistriesQuery, useCreateCoworkThreadMutation } from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/preference-resolvers";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import {
  type WorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

export function useCoworkThreadWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { agents } = useAgentCatalog();
  const { data: modelRegistries = EMPTY_MODEL_REGISTRIES } = useModelRegistriesQuery();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
  })));
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const setDraft = useChatInputStore((state) => state.setDraft);
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const createCoworkThreadMutation = useCreateCoworkThreadMutation();

  const navigateToWorkspaceShell = useCallback(() => {
    if (location.pathname !== "/") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const createThreadWithResolvedConfig = useCallback(async (input: {
    agentKind: string;
    modelId: string;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    const modeId = resolveCoworkDefaultSessionModeId(input.agentKind);
    const { mcpServers } = await resolveSessionMcpServersForLaunch({
      targetLocation: "local",
      workspacePath: null,
    });
    const result = await createCoworkThreadMutation.mutateAsync({
      agentKind: input.agentKind,
      modelId: input.modelId,
      ...(modeId ? { modeId } : {}),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
    });

    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => upsertLocalWorkspaceCollections(collections, result.workspace),
    );
    upsertWorkspaceSessionRecord(result.workspace.id, result.session);
    if (input.draftText?.length) {
      setDraft(result.workspace.id, input.draftText);
      if (input.sourceWorkspaceId && input.sourceWorkspaceId !== result.workspace.id) {
        clearDraft(input.sourceWorkspaceId);
      }
    }
    navigateToWorkspaceShell();
    await selectWorkspace(result.workspace.id, { force: true });
    return result;
  }, [
    createCoworkThreadMutation,
    clearDraft,
    navigateToWorkspaceShell,
    queryClient,
    runtimeUrl,
    selectWorkspace,
    setDraft,
    upsertWorkspaceSessionRecord,
  ]);

  const createThread = useCallback(async () => {
    const defaults = resolveEffectiveChatDefaults(
      modelRegistries,
      agents,
      preferences,
      null,
    );

    if (!defaults.agentKind || !defaults.modelId) {
      throw new Error(defaults.degradedReason ?? "No ready agents are available.");
    }

    if (defaults.degradedReason) {
      showToast(defaults.degradedReason, "info");
    }

    return createThreadWithResolvedConfig({
      agentKind: defaults.agentKind,
      modelId: defaults.modelId,
    });
  }, [
    agents,
    createThreadWithResolvedConfig,
    modelRegistries,
    preferences,
    showToast,
  ]);

  const createThreadFromSelection = useCallback(async (input: {
    agentKind: string;
    modelId: string;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    return createThreadWithResolvedConfig({
      agentKind: input.agentKind,
      modelId: input.modelId,
      draftText: input.draftText,
      sourceWorkspaceId: input.sourceWorkspaceId,
    });
  }, [createThreadWithResolvedConfig]);

  const openThread = useCallback(async (workspaceId: string) => {
    navigateToWorkspaceShell();
    await selectWorkspace(workspaceId, { force: true });
  }, [navigateToWorkspaceShell, selectWorkspace]);

  return {
    createThread,
    createThreadFromSelection,
    openThread,
    isCreatingThread: createCoworkThreadMutation.isPending,
  };
}
