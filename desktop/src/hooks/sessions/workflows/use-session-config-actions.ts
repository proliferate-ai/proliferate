import { useSetSessionConfigOptionMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { persistDefaultSessionModePreference } from "@/hooks/sessions/session-mode-preferences";
import type { SessionConfigOptionUpdateOptions } from "@/hooks/sessions/workflows/session-control-contract";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import {
  resolveStatusFromExecutionSummary,
} from "@/lib/domain/sessions/activity";
import {
  getAuthoritativeConfigValue,
  shouldAcceptAuthoritativeLiveConfig,
  withPendingConfigChange,
  withoutPendingConfigChange,
} from "@/lib/domain/sessions/pending-config";
import {
  getSessionRecord,
  isPendingSessionId,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  getSessionClientAndWorkspace,
} from "@/lib/workflows/sessions/session-runtime";

let nextPendingConfigMutationId = 0;

export function useSessionConfigActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showToast = useToastStore((state) => state.show);
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const setSessionConfigOptionMutation = useSetSessionConfigOptionMutation();

  const setActiveSessionConfigOption = useCallback(async (
    configId: string,
    value: string,
    options?: SessionConfigOptionUpdateOptions,
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }
    const currentSlot = getSessionRecord(sessionId);
    if (isPendingSessionId(sessionId) || currentSlot?.materializedSessionId === null) {
      if (!currentSlot) {
        throw new Error("No active session");
      }
      const mutationId = ++nextPendingConfigMutationId;
      patchSessionRecord(sessionId, {
        ...(configId === "model" ? { modelId: value } : {}),
        ...(configId === "mode" ? { modeId: value } : {}),
        pendingConfigChanges: withPendingConfigChange(
          currentSlot?.pendingConfigChanges ?? {},
          {
            rawConfigId: configId,
            value,
            status: "queued",
            mutationId,
          },
        ),
      });
      return;
    }

    const workspaceId = currentSlot?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const mutationId = ++nextPendingConfigMutationId;
    patchSessionRecord(sessionId, {
      pendingConfigChanges: withPendingConfigChange(
        currentSlot?.pendingConfigChanges ?? {},
        {
          rawConfigId: configId,
          value,
          status: "submitting",
          mutationId,
        },
      ),
    });

    try {
      const { materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
      const response = await setSessionConfigOptionMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        request: { configId, value },
      });

      if (workspaceId) {
        upsertWorkspaceSessionRecord(workspaceId, response.session);
      }

      const latestSlot = getSessionRecord(sessionId);
      if (!latestSlot) {
        return response;
      }

      const responseLiveConfig = response.liveConfig ?? response.session.liveConfig ?? null;
      const shouldReplaceLiveConfig = shouldAcceptAuthoritativeLiveConfig(
        latestSlot.liveConfig,
        responseLiveConfig,
      );
      const shouldApplyConfigFields = shouldReplaceLiveConfig || !latestSlot.liveConfig;
      const effectiveLiveConfig = shouldReplaceLiveConfig
        ? responseLiveConfig
        : latestSlot.liveConfig;
      const currentPendingChange = latestSlot.pendingConfigChanges[configId] ?? null;
      const isLatestMutation = currentPendingChange?.mutationId === mutationId;
      let nextPendingConfigChanges = latestSlot.pendingConfigChanges;

      if (isLatestMutation) {
        nextPendingConfigChanges = response.applyState === "applied"
          ? withoutPendingConfigChange(nextPendingConfigChanges, configId)
          : withPendingConfigChange(nextPendingConfigChanges, {
            ...currentPendingChange,
            status: "queued",
          });
      }

      const nextPatch = {
        agentKind: response.session.agentKind,
        executionSummary: response.session.executionSummary ?? latestSlot.executionSummary ?? null,
        status: resolveStatusFromExecutionSummary(
          response.session.executionSummary ?? latestSlot.executionSummary ?? null,
          response.session.status,
        ),
        title: response.session.title ?? latestSlot.title ?? null,
        lastPromptAt: response.session.lastPromptAt ?? latestSlot.lastPromptAt ?? null,
        workspaceId,
        pendingConfigChanges: nextPendingConfigChanges,
      } as const;

      if (shouldApplyConfigFields) {
        patchSessionRecord(sessionId, {
          ...nextPatch,
          liveConfig: effectiveLiveConfig,
          modelId:
            effectiveLiveConfig?.normalizedControls.model?.currentValue
            ?? response.session.modelId
            ?? latestSlot.modelId
            ?? null,
          modeId:
            effectiveLiveConfig?.normalizedControls.mode?.currentValue
            ?? response.session.modeId
            ?? latestSlot.modeId
            ?? null,
          transcript: {
            ...latestSlot.transcript,
            currentModeId:
              effectiveLiveConfig?.normalizedControls.mode?.currentValue
              ?? response.session.modeId
              ?? latestSlot.transcript.currentModeId,
          },
        });
      } else {
        patchSessionRecord(sessionId, nextPatch);
      }

      if (isLatestMutation && response.applyState === "queued") {
        showToast("Config update queued. It will apply at end of turn.", "info");
      }

      if (
        isLatestMutation
        && response.applyState === "applied"
        && options?.persistDefaultPreference !== false
      ) {
        persistDefaultSessionModePreference({
          agentKind: response.session.agentKind ?? latestSlot.agentKind,
          liveConfigRawConfigId: effectiveLiveConfig?.normalizedControls.mode?.rawConfigId ?? null,
          rawConfigId: configId,
          modeId: getAuthoritativeConfigValue(effectiveLiveConfig, configId) ?? value,
          workspaceSurface: getWorkspaceSurface(workspaceId),
        });
      }

      return response;
    } catch (error) {
      const latestSlot = getSessionRecord(sessionId);
      if (latestSlot?.pendingConfigChanges[configId]?.mutationId === mutationId) {
        patchSessionRecord(sessionId, {
          pendingConfigChanges: withoutPendingConfigChange(
            latestSlot.pendingConfigChanges,
            configId,
          ),
        });
      }
      throw error;
    }
  }, [
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSurface,
    setSessionConfigOptionMutation,
    showToast,
    upsertWorkspaceSessionRecord,
  ]);

  return { setActiveSessionConfigOption };
}
