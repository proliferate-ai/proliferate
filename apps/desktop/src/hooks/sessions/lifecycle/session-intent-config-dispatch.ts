import type { Session } from "@anyharness/sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { useSetSessionConfigOptionMutation } from "@anyharness/sdk-react";
import {
  getAuthoritativeConfigValue,
  shouldAcceptAuthoritativeLiveConfig,
} from "@proliferate/product-domain/sessions/pending-config";
import {
  resolveStatusFromExecutionSummary,
} from "@proliferate/product-domain/sessions/activity";
import type {
  SessionUpdateConfigIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import {
  getSessionClientAndWorkspace,
} from "@/lib/access/anyharness/session-runtime";
import {
  persistDefaultSessionModePreference,
} from "@/hooks/sessions/workflows/session-mode-preferences";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

type SetSessionConfigOptionMutation = ReturnType<typeof useSetSessionConfigOptionMutation>;

export interface ConfigIntentDispatchDeps {
  ssh?: DesktopSshBridge | null;
  getWorkspaceSurface: (
    workspaceId: string | null | undefined,
  ) => Parameters<typeof persistDefaultSessionModePreference>[0]["workspaceSurface"];
  setSessionConfigOptionMutation: SetSessionConfigOptionMutation;
  upsertWorkspaceSessionRecord: (
    workspaceId: string,
    session: Session,
  ) => void;
}

export async function dispatchConfigIntent(
  intent: SessionUpdateConfigIntent,
  deps: ConfigIntentDispatchDeps,
): Promise<void> {
  const current = useSessionIntentStore.getState().entriesById[intent.intentId];
  if (!current || current.kind !== "update_config" || current.status !== "queued") {
    return;
  }
  useSessionIntentStore.getState().patchIntent(intent.intentId, {
    status: "dispatching",
    errorMessage: null,
    dispatchedAt: new Date().toISOString(),
  });
  try {
    const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(
      intent.clientSessionId,
      deps.ssh ?? null,
    );
    useSessionIntentStore.getState().bindMaterializedSession(
      intent.clientSessionId,
      materializedSessionId,
    );
    const response = await deps.setSessionConfigOptionMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      request: { configId: intent.configId, value: intent.value },
    });
    if (workspaceId) {
      deps.upsertWorkspaceSessionRecord(workspaceId, response.session);
    }
    const latestSlot = getSessionRecord(intent.clientSessionId);
    const responseLiveConfig = response.liveConfig ?? response.session.liveConfig ?? null;
    if (latestSlot) {
      const shouldReplaceLiveConfig = shouldAcceptAuthoritativeLiveConfig(
        latestSlot.liveConfig,
        responseLiveConfig,
      );
      const effectiveLiveConfig = shouldReplaceLiveConfig
        ? responseLiveConfig
        : latestSlot.liveConfig;
      const isModelConfigIntent =
        intent.configId === "model"
        || responseLiveConfig?.normalizedControls.model?.rawConfigId === intent.configId
        || latestSlot.liveConfig?.normalizedControls.model?.rawConfigId === intent.configId;
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
        requestedModelId:
          response.session.requestedModelId
          ?? (isModelConfigIntent ? intent.value : null)
          ?? latestSlot.requestedModelId
          ?? null,
      } as const;
      if (effectiveLiveConfig) {
        patchSessionRecord(intent.clientSessionId, {
          ...nextPatch,
          liveConfig: effectiveLiveConfig,
          modelId:
            effectiveLiveConfig.normalizedControls.model?.currentValue
            ?? response.session.modelId
            ?? latestSlot.modelId
            ?? null,
          modeId:
            effectiveLiveConfig.normalizedControls.mode?.currentValue
            ?? response.session.modeId
            ?? latestSlot.modeId
            ?? null,
          transcript: {
            ...latestSlot.transcript,
            currentModeId:
              effectiveLiveConfig.normalizedControls.mode?.currentValue
              ?? response.session.modeId
              ?? latestSlot.transcript.currentModeId,
          },
        });
      } else {
        patchSessionRecord(intent.clientSessionId, nextPatch);
      }
      if (response.applyState === "applied" && intent.persistDefaultPreference) {
        persistDefaultSessionModePreference({
          agentKind: response.session.agentKind ?? latestSlot.agentKind,
          liveConfigRawConfigId: effectiveLiveConfig?.normalizedControls.mode?.rawConfigId ?? null,
          rawConfigId: intent.configId,
          modeId: getAuthoritativeConfigValue(effectiveLiveConfig, intent.configId) ?? intent.value,
          workspaceSurface: deps.getWorkspaceSurface(workspaceId),
        });
      }
    }
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "accepted",
      applyState: response.applyState,
      materializedSessionId: response.session.id,
      workspaceId,
      acceptedAt: new Date().toISOString(),
      errorMessage: null,
    });
    logLatency("session.intent.config.dispatch.accepted", {
      intentId: intent.intentId,
      clientSessionId: intent.clientSessionId,
      workspaceId,
      materializedSessionId: response.session.id,
      configId: intent.configId,
      applyState: response.applyState,
    });
  } catch (error) {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
