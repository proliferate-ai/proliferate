import type { Session } from "@anyharness/sdk";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import type { useSetSessionConfigOptionMutation } from "@anyharness/sdk-react";
import {
  shouldAcceptAuthoritativeLiveConfig,
} from "#product/domain/sessions/pending-config";
import {
  resolveStatusFromExecutionSummary,
} from "#product/domain/sessions/activity";
import type {
  SessionUpdateConfigIntent,
} from "#product/domain/sessions/intents/session-intent-model";
import {
  getSessionClientAndWorkspace,
} from "#product/lib/access/anyharness/session-runtime";
import {
  persistDefaultSessionControlPreference,
} from "#product/hooks/sessions/workflows/session-control-preferences";
import {
  getSessionRecord,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import {
  abandonRendererFlow,
  finishRendererFlow,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";

type SetSessionConfigOptionMutation = ReturnType<typeof useSetSessionConfigOptionMutation>;

export const CONFIG_INTENT_DISPATCH_TIMEOUT_MS = 15_000;

export interface ConfigIntentDispatchDeps {
  cloudClient: CloudSandboxGatewayUrlSource | null;
  getWorkspaceSurface: (
    workspaceId: string | null | undefined,
  ) => Parameters<typeof persistDefaultSessionControlPreference>[0]["workspaceSurface"];
  setSessionConfigOptionMutation: SetSessionConfigOptionMutation;
  upsertWorkspaceSessionRecord: (
    workspaceId: string,
    session: Session,
  ) => void;
  timeoutMs?: number;
  onFailure?: (message: string) => void;
}

export async function dispatchConfigIntent(
  selectedIntent: SessionUpdateConfigIntent,
  deps: ConfigIntentDispatchDeps,
): Promise<void> {
  const current = useSessionIntentStore.getState().entriesById[selectedIntent.intentId];
  if (!current || current.kind !== "update_config" || current.status !== "queued") {
    return;
  }
  // Dispatch the store record, not the caller's snapshot: a queued intent can
  // be superseded in place (tail coalescing) after the dispatcher selects it,
  // and the wire payload must carry the superseding value.
  const intent = current;
  if (!intent.rawConfigId) {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "stale",
      errorMessage: null,
    });
    return;
  }
  const rawConfigId = intent.rawConfigId;
  const dispatchedAt = new Date().toISOString();
  useSessionIntentStore.getState().patchIntent(intent.intentId, {
    status: "dispatching",
    errorMessage: null,
    dispatchedAt,
  });
  try {
    const { response, workspaceId } = await runConfigDispatchWithTimeout(
      deps.timeoutMs ?? CONFIG_INTENT_DISPATCH_TIMEOUT_MS,
      async (signal) => {
        const target = await getSessionClientAndWorkspace(
          intent.clientSessionId,
          deps.cloudClient,
        );
        if (signal.aborted || !isCurrentConfigDispatch(intent.intentId, dispatchedAt)) {
          throw new Error(signal.aborted ? "request timed out" : "config dispatch superseded");
        }
        useSessionIntentStore.getState().bindMaterializedSession(
          intent.clientSessionId,
          target.materializedSessionId,
        );
        const response = await deps.setSessionConfigOptionMutation.mutateAsync({
          workspaceId: target.workspaceId,
          sessionId: target.materializedSessionId,
          request: { configId: rawConfigId, value: intent.value },
          requestOptions: { signal },
          awaitInvalidations: false,
        });
        return { response, workspaceId: target.workspaceId };
      },
    );
    if (!isCurrentConfigDispatch(intent.intentId, dispatchedAt)) {
      return;
    }
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
        intent.controlKey === "model"
        || responseLiveConfig?.normalizedControls.model?.rawConfigId === rawConfigId
        || latestSlot.liveConfig?.normalizedControls.model?.rawConfigId === rawConfigId;
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
            ?? null,
          transcript: {
            ...latestSlot.transcript,
            currentModeId:
              effectiveLiveConfig.normalizedControls.mode?.currentValue
              ?? null,
          },
        });
      } else {
        patchSessionRecord(intent.clientSessionId, nextPatch);
      }
      if (response.applyState === "applied" && intent.persistDefaultPreference) {
        persistDefaultSessionControlPreference({
          agentKind: response.session.agentKind ?? latestSlot.agentKind,
          liveConfig: effectiveLiveConfig,
          rawConfigId,
          requestedValue: intent.value,
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
      configId: rawConfigId,
      applyState: response.applyState,
    });
    if (intent.controlKey === "mode") {
      // UX-latency R12: commit mark, only reached once a superseding dispatch
      // hasn't raced past this one (isCurrentConfigDispatch check above).
      finishRendererFlow({
        kind: "mode_switch",
        correlationKey: intent.intentId,
        detail: { apply_state: response.applyState },
      });
    }
  } catch (error) {
    if (!isCurrentConfigDispatch(intent.intentId, dispatchedAt)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "failed",
      errorMessage: message,
    });
    if (intent.controlKey === "mode") {
      abandonRendererFlow({
        kind: "mode_switch",
        correlationKey: intent.intentId,
        reason: "dispatch_failed",
      });
    }
    deps.onFailure?.(message);
  }
}

function isCurrentConfigDispatch(intentId: string, dispatchedAt: string): boolean {
  const current = useSessionIntentStore.getState().entriesById[intentId];
  return current?.kind === "update_config"
    && current.status === "dispatching"
    && current.dispatchedAt === dispatchedAt;
}

async function runConfigDispatchWithTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutError = new Error("request timed out");
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    const request = run(controller.signal);
    request.catch(() => undefined);
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
