import { useCallback, useEffect, useRef } from "react";
import {
  useDeletePendingPromptMutation,
  useEditPendingPromptMutation,
  usePromptSessionMutation,
  useResolveSessionInteractionMutation,
  useSetSessionConfigOptionMutation,
} from "@anyharness/sdk-react";
import {
  promptAttachmentSnapshotsToBlocks,
} from "@/lib/access/browser/prompt-attachment-blocks";
import {
  failLatencyFlow,
  finishLatencyFlow,
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  classifyPromptDispatchFailure,
} from "@proliferate/product-model/sessions/intents/prompt-dispatch-failure";
import {
  transcriptHasRenderablePromptEcho,
} from "@proliferate/product-model/sessions/intents/prompt-echo";
import {
  selectNextDispatchableSessionIntent,
} from "@proliferate/product-model/sessions/intents/session-intent-selectors";
import type {
  PromptOutboxEntry,
  SessionIntent,
  SessionUpdateConfigIntent,
} from "@proliferate/product-model/sessions/intents/session-intent-model";
import {
  getAuthoritativeConfigValue,
  shouldAcceptAuthoritativeLiveConfig,
} from "@proliferate/product-model/sessions/pending-config";
import {
  resolveStatusFromExecutionSummary,
} from "@proliferate/product-model/sessions/activity";
import {
  getSessionClientAndWorkspace,
} from "@/lib/workflows/sessions/session-runtime";
import {
  waitForSessionMaterialization,
} from "@/lib/workflows/sessions/session-materialization";
import {
  sessionMaterializationDeps,
} from "@/hooks/sessions/workflows/session-materialization-deps";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useSessionTitleActions } from "@/hooks/sessions/workflows/use-session-title-actions";
import {
  persistDefaultSessionModePreference,
} from "@/hooks/sessions/workflows/session-mode-preferences";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

const SESSION_READY_TIMEOUT_MS = 5_000;
const ACCEPTED_RUNNING_RECONCILE_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000] as const;
const ACCEPTED_RUNNING_RECONCILE_TIMEOUT_MS = 3_000;

let activeDispatcherOwner: symbol | null = null;

export function useSessionIntentDispatcher(): void {
  const dispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const { applySessionSummary } = useSessionSummaryActions();
  const { maybeGenerateSessionTitle } = useSessionTitleActions();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const promptSessionMutation = usePromptSessionMutation();
  const setSessionConfigOptionMutation = useSetSessionConfigOptionMutation();
  const resolveInteractionMutation = useResolveSessionInteractionMutation();
  const editPendingPromptMutation = useEditPendingPromptMutation();
  const deletePendingPromptMutation = useDeletePendingPromptMutation();
  const inFlightSessionIdsRef = useRef(new Set<string>());
  const dispatcherOwnerRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (activeDispatcherOwner) {
      return;
    }
    const owner = Symbol("session-intent-dispatcher");
    activeDispatcherOwner = owner;
    dispatcherOwnerRef.current = owner;
    return () => {
      if (activeDispatcherOwner === owner) {
        activeDispatcherOwner = null;
      }
      dispatcherOwnerRef.current = null;
    };
  }, []);

  const dispatchPromptIntent = useCallback(async (entry: PromptOutboxEntry) => {
    const store = useSessionIntentStore.getState();
    const current = store.entriesById[entry.intentId];
    if (!current || current.kind !== "send_prompt" || current.deliveryState !== "waiting_for_session") {
      return;
    }

    let requestStarted = false;
    let requestHeaders: HeadersInit | null = null;
    try {
      store.patchIntent(entry.intentId, {
        status: "preparing",
        deliveryState: "preparing",
        errorMessage: null,
      });
      logLatency("session.intent.prompt.dispatch.prepare", {
        clientPromptId: entry.clientPromptId,
        clientSessionId: entry.clientSessionId,
        entryWorkspaceId: entry.workspaceId,
        entryMaterializedSessionId: entry.materializedSessionId,
        placement: entry.placement,
        blockTypes: entry.blocks.map((block) => block.type),
        attachmentCount: entry.attachmentSnapshots.length,
      });

      const materializedSessionId = await waitForSessionMaterialization(
        entry.clientSessionId,
        sessionMaterializationDeps,
        { timeoutMs: SESSION_READY_TIMEOUT_MS },
      );
      useSessionIntentStore.getState().bindMaterializedSession(
        entry.clientSessionId,
        materializedSessionId,
      );
      const latestBeforeDispatch = useSessionIntentStore
        .getState()
        .entriesById[entry.intentId];
      if (!latestBeforeDispatch || latestBeforeDispatch.kind !== "send_prompt" || latestBeforeDispatch.deliveryState !== "preparing") {
        return;
      }

      const sessionBeforePrompt = getSessionRecord(entry.clientSessionId);
      const shouldGenerateTitle = !sessionBeforePrompt?.lastPromptAt;
      const preparedBlocks = await preparePromptBlocks(latestBeforeDispatch);
      const latestAfterPrepare = useSessionIntentStore
        .getState()
        .entriesById[entry.intentId];
      if (!latestAfterPrepare || latestAfterPrepare.kind !== "send_prompt" || latestAfterPrepare.deliveryState !== "preparing") {
        return;
      }
      const {
        workspaceId,
        materializedSessionId: resolvedSessionId,
      } = await getSessionClientAndWorkspace(entry.clientSessionId);
      requestHeaders = getLatencyFlowRequestHeaders(entry.latencyFlowId) ?? null;
      const requestOptions = requestHeaders ? { headers: requestHeaders } : undefined;

      useSessionIntentStore.getState().patchIntent(entry.intentId, {
        status: "dispatching",
        deliveryState: "dispatching",
        materializedSessionId: resolvedSessionId,
        workspaceId,
        dispatchedAt: new Date().toISOString(),
      });
      requestStarted = true;
      const response = await promptSessionMutation.mutateAsync({
        workspaceId,
        sessionId: resolvedSessionId,
        request: {
          promptId: entry.clientPromptId,
          blocks: preparedBlocks,
        },
        requestOptions,
      });

      applySessionSummary(entry.clientSessionId, response.session, workspaceId);
      upsertWorkspaceSessionRecord(workspaceId, response.session);
      useSessionIntentStore.getState().patchIntent(entry.intentId, {
        status: "accepted",
        deliveryState: response.status === "queued" ? "accepted_queued" : "accepted_running",
        placement: response.status === "queued" ? "queue" : "transcript",
        queuedSeq: response.queuedSeq ?? null,
        materializedSessionId: response.session.id,
        workspaceId,
        acceptedAt: new Date().toISOString(),
        errorMessage: null,
      });
      logLatency("session.intent.prompt.dispatch.accepted", {
        clientPromptId: entry.clientPromptId,
        clientSessionId: entry.clientSessionId,
        workspaceId,
        materializedSessionId: response.session.id,
        responseStatus: response.status,
        queuedSeq: response.queuedSeq ?? null,
      });
      finishLatencyFlow(entry.latencyFlowId, "processing_started", {
        keepActive: true,
      });
      if (response.status !== "queued") {
        scheduleAcceptedRunningHistoryReconcile({
          clientSessionId: entry.clientSessionId,
          clientPromptId: entry.clientPromptId,
          requestHeaders,
          rehydrateSessionSlotFromHistory,
        });
      }

      if (shouldGenerateTitle) {
        void maybeGenerateSessionTitle({
          sessionId: entry.clientSessionId,
          firstUserMessage: entry.text,
        });
      }
    } catch (error) {
      const failure = classifyPromptDispatchFailure(error, requestStarted);
      useSessionIntentStore.getState().patchIntent(entry.intentId, {
        status: failure.deliveryState === "failed_before_dispatch" ? "failed" : "dispatching",
        deliveryState: failure.deliveryState,
        errorMessage: failure.message,
      });
      if (failure.deliveryState === "failed_before_dispatch") {
        failLatencyFlow(
          entry.latencyFlowId,
          requestStarted ? "prompt_dispatch_rejected" : "prompt_dispatch_failed_before_request",
        );
      } else {
        scheduleAcceptedRunningHistoryReconcile({
          clientSessionId: entry.clientSessionId,
          clientPromptId: entry.clientPromptId,
          requestHeaders,
          rehydrateSessionSlotFromHistory,
        });
      }
    }
  }, [
    applySessionSummary,
    maybeGenerateSessionTitle,
    promptSessionMutation,
    rehydrateSessionSlotFromHistory,
    upsertWorkspaceSessionRecord,
  ]);

  const dispatchConfigIntent = useCallback(async (intent: SessionUpdateConfigIntent) => {
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
      const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(intent.clientSessionId);
      useSessionIntentStore.getState().bindMaterializedSession(
        intent.clientSessionId,
        materializedSessionId,
      );
      const response = await setSessionConfigOptionMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        request: { configId: intent.configId, value: intent.value },
      });
      if (workspaceId) {
        upsertWorkspaceSessionRecord(workspaceId, response.session);
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
            workspaceSurface: getWorkspaceSurface(workspaceId),
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
  }, [
    getWorkspaceSurface,
    setSessionConfigOptionMutation,
    upsertWorkspaceSessionRecord,
  ]);

  const dispatchInteractionIntent = useCallback(async (
    intent: Extract<SessionIntent, { kind: "resolve_interaction" }>,
  ) => {
    const current = useSessionIntentStore.getState().entriesById[intent.intentId];
    if (!current || current.kind !== "resolve_interaction" || current.status !== "queued") {
      return;
    }
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "dispatching",
      errorMessage: null,
      dispatchedAt: new Date().toISOString(),
    });
    try {
      const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(intent.clientSessionId);
      useSessionIntentStore.getState().bindMaterializedSession(
        intent.clientSessionId,
        materializedSessionId,
      );
      await resolveInteractionMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        requestId: intent.requestId,
        request: intent.request,
      });
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "accepted",
        materializedSessionId,
        workspaceId,
        acceptedAt: new Date().toISOString(),
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stale = /not found|missing|unknown/i.test(message);
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: stale ? "stale" : "failed",
        errorMessage: stale ? null : message,
      });
    }
  }, [resolveInteractionMutation]);

  const dispatchEditPendingPromptIntent = useCallback(async (
    intent: Extract<SessionIntent, { kind: "edit_pending_prompt" }>,
  ) => {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "dispatching",
      errorMessage: null,
      dispatchedAt: new Date().toISOString(),
    });
    try {
      const { materializedSessionId } = await getSessionClientAndWorkspace(intent.clientSessionId);
      await editPendingPromptMutation.mutateAsync({
        sessionId: materializedSessionId,
        seq: intent.seq,
        text: intent.text,
      });
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "accepted",
        materializedSessionId,
        acceptedAt: new Date().toISOString(),
      });
    } catch (error) {
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, [editPendingPromptMutation]);

  const dispatchDeletePendingPromptIntent = useCallback(async (
    intent: Extract<SessionIntent, { kind: "delete_pending_prompt" }>,
  ) => {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "dispatching",
      errorMessage: null,
      dispatchedAt: new Date().toISOString(),
    });
    try {
      const { materializedSessionId } = await getSessionClientAndWorkspace(intent.clientSessionId);
      await deletePendingPromptMutation.mutateAsync({
        sessionId: materializedSessionId,
        seq: intent.seq,
      });
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "accepted",
        materializedSessionId,
        acceptedAt: new Date().toISOString(),
      });
    } catch (error) {
      useSessionIntentStore.getState().patchIntent(intent.intentId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, [deletePendingPromptMutation]);

  const dispatchIntent = useCallback(async (intent: SessionIntent) => {
    switch (intent.kind) {
      case "send_prompt":
        await dispatchPromptIntent(intent);
        break;
      case "update_config":
        await dispatchConfigIntent(intent);
        break;
      case "resolve_interaction":
        await dispatchInteractionIntent(intent);
        break;
      case "edit_pending_prompt":
        await dispatchEditPendingPromptIntent(intent);
        break;
      case "delete_pending_prompt":
        await dispatchDeletePendingPromptIntent(intent);
        break;
    }
  }, [
    dispatchConfigIntent,
    dispatchDeletePendingPromptIntent,
    dispatchEditPendingPromptIntent,
    dispatchInteractionIntent,
    dispatchPromptIntent,
  ]);

  useEffect(() => {
    if (!isActiveDispatcherOwner(dispatcherOwnerRef.current)) {
      return;
    }

    const state = useSessionIntentStore.getState();
    for (const clientSessionId of Object.keys(state.intentIdsByClientSessionId)) {
      if (inFlightSessionIdsRef.current.has(clientSessionId)) {
        continue;
      }
      const intent = selectNextDispatchableSessionIntent(state, clientSessionId);
      if (!intent) {
        continue;
      }
      const record = getSessionRecord(clientSessionId);
      if (!record?.materializedSessionId) {
        logLatency("session.intent.dispatch.waiting_unmaterialized", {
          clientSessionId,
          nextIntentId: intent.intentId,
          nextIntentKind: intent.kind,
          hasRecord: Boolean(record),
          workspaceId: record?.workspaceId ?? intent.workspaceId,
          status: record?.status ?? null,
          transcriptHydrated: record?.transcriptHydrated ?? null,
          intentWorkspaceId: intent.workspaceId,
          intentCount: state.intentIdsByClientSessionId[clientSessionId]?.length ?? 0,
        });
        continue;
      }
      inFlightSessionIdsRef.current.add(clientSessionId);
      void dispatchIntent(intent).finally(() => {
        inFlightSessionIdsRef.current.delete(clientSessionId);
      });
    }
  }, [dispatchIntent, dispatchVersion]);
}

function isActiveDispatcherOwner(owner: symbol | null): boolean {
  return owner !== null && activeDispatcherOwner === owner;
}

async function preparePromptBlocks(entry: PromptOutboxEntry) {
  if (entry.attachmentSnapshots.length === 0) {
    return entry.blocks;
  }
  const planBlocks = entry.blocks.filter((block) => block.type === "plan_reference");
  return [
    ...await promptAttachmentSnapshotsToBlocks(entry.text.trim(), entry.attachmentSnapshots),
    ...planBlocks,
  ];
}

function scheduleAcceptedRunningHistoryReconcile({
  clientSessionId,
  clientPromptId,
  requestHeaders,
  rehydrateSessionSlotFromHistory,
}: {
  clientSessionId: string;
  clientPromptId: string;
  requestHeaders: HeadersInit | null;
  rehydrateSessionSlotFromHistory: ReturnType<typeof useSessionHistoryHydration>["rehydrateSessionSlotFromHistory"];
}): void {
  for (const delayMs of ACCEPTED_RUNNING_RECONCILE_DELAYS_MS) {
    window.setTimeout(() => {
      if (transcriptHasPromptId(clientSessionId, clientPromptId)) {
        return;
      }
      const slot = getSessionRecord(clientSessionId);
      if (!slot) {
        return;
      }
      const afterSeq = Math.max(
        slot.transcript.lastSeq,
        slot.events[slot.events.length - 1]?.seq ?? 0,
      );
      void rehydrateSessionSlotFromHistory(clientSessionId, {
        afterSeq,
        limit: 100,
        timeoutMs: ACCEPTED_RUNNING_RECONCILE_TIMEOUT_MS,
        ...(requestHeaders ? { requestHeaders } : {}),
      });
    }, delayMs);
  }
}

function transcriptHasPromptId(clientSessionId: string, clientPromptId: string): boolean {
  const transcript = getSessionRecord(clientSessionId)?.transcript ?? null;
  if (!transcript) {
    return false;
  }
  return transcriptHasRenderablePromptEcho(transcript, clientPromptId);
}
