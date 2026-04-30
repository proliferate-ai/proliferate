import { useCallback } from "react";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import { resolveFallbackSessionModelId } from "@/lib/domain/sessions/model-fallback";
import { getSessionClientAndWorkspace } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";

export function useSessionModelFallbackAction() {
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();

  return useCallback(async (sessionId: string, fallbackModelId: string) => {
    const { connection, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    const response = await getAnyHarnessClient(connection).sessions.setConfigOption(sessionId, {
      configId: "model",
      value: fallbackModelId,
    });

    upsertWorkspaceSessionRecord(workspaceId, response.session);

    const latestSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    if (!latestSlot) {
      return response;
    }

    const liveConfig = response.liveConfig ?? response.session.liveConfig ?? latestSlot.liveConfig;
    useHarnessStore.getState().patchSessionSlot(sessionId, {
      agentKind: response.session.agentKind,
      executionSummary: response.session.executionSummary ?? latestSlot.executionSummary ?? null,
      liveConfig,
      modelId: resolveFallbackSessionModelId({
        responseModelId: response.session.modelId,
        responseRequestedModelId: response.session.requestedModelId,
        liveConfig,
        fallbackModelId,
      }),
      modeId:
        liveConfig?.normalizedControls.mode?.currentValue
        ?? response.session.modeId
        ?? latestSlot.modeId
        ?? null,
      status: resolveStatusFromExecutionSummary(
        response.session.executionSummary ?? latestSlot.executionSummary ?? null,
        response.session.status,
      ),
      title: response.session.title ?? latestSlot.title ?? null,
      lastPromptAt: response.session.lastPromptAt ?? latestSlot.lastPromptAt ?? null,
      workspaceId,
    });

    return response;
  }, [upsertWorkspaceSessionRecord]);
}
