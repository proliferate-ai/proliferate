import { useCallback, useEffect, useRef } from "react";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import {
  selectNextDispatchableOutboxEntry,
  type PromptOutboxEntry,
} from "@/lib/domain/chat/prompt-outbox";
import {
  getLatencyFlowRequestHeaders,
  failLatencyFlow,
  finishLatencyFlow,
} from "@/lib/infra/latency-flow";
import {
  getSessionClientAndWorkspace,
} from "@/lib/integrations/anyharness/session-runtime";
import {
  getSessionRecord,
  waitForSessionMaterialization,
} from "@/stores/sessions/session-records";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";

const CONFIG_READY_TIMEOUT_MS = 5_000;
const ACCEPTED_RUNNING_RECONCILE_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000] as const;
const ACCEPTED_RUNNING_RECONCILE_TIMEOUT_MS = 3_000;

let activeDispatcherOwner: symbol | null = null;

export function usePromptOutboxDispatcher(): void {
  const dispatchVersion = usePromptOutboxStore((state) => state.dispatchVersion);
  const { applySessionSummary, rehydrateSessionSlotFromHistory } = useSessionRuntimeActions();
  const { maybeGenerateSessionTitle } = useSessionTitleActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const inFlightSessionIdsRef = useRef(new Set<string>());
  const dispatcherOwnerRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (activeDispatcherOwner) {
      return;
    }
    const owner = Symbol("prompt-outbox-dispatcher");
    activeDispatcherOwner = owner;
    dispatcherOwnerRef.current = owner;
    return () => {
      if (activeDispatcherOwner === owner) {
        activeDispatcherOwner = null;
      }
      dispatcherOwnerRef.current = null;
    };
  }, []);

  const dispatchEntry = useCallback(async (entry: PromptOutboxEntry) => {
    const store = usePromptOutboxStore.getState();
    const current = store.entriesByPromptId[entry.clientPromptId];
    if (
      !current
      || (
        current.deliveryState !== "waiting_for_session"
      )
    ) {
      return;
    }

    let requestStarted = false;
    try {
      store.patchEntry(entry.clientPromptId, {
        deliveryState: "preparing",
        errorMessage: null,
      });

      const materializedSessionId = await waitForSessionMaterialization(
        entry.clientSessionId,
        CONFIG_READY_TIMEOUT_MS,
      );
      usePromptOutboxStore.getState().bindMaterializedSession(
        entry.clientSessionId,
        materializedSessionId,
      );
      const latestBeforeDispatch = usePromptOutboxStore
        .getState()
        .entriesByPromptId[entry.clientPromptId];
      if (!latestBeforeDispatch || latestBeforeDispatch.deliveryState !== "preparing") {
        return;
      }

      const sessionBeforePrompt = getSessionRecord(entry.clientSessionId);
      const shouldGenerateTitle = !sessionBeforePrompt?.lastPromptAt;
      const {
        connection,
        workspaceId,
        materializedSessionId: resolvedSessionId,
      } = await getSessionClientAndWorkspace(entry.clientSessionId);
      const requestHeaders = getLatencyFlowRequestHeaders(entry.latencyFlowId) ?? null;
      const requestOptions = requestHeaders ? { headers: requestHeaders } : undefined;

      usePromptOutboxStore.getState().patchEntry(entry.clientPromptId, {
        deliveryState: "dispatching",
        materializedSessionId: resolvedSessionId,
        workspaceId,
        dispatchedAt: new Date().toISOString(),
      });
      requestStarted = true;
      const response = await getAnyHarnessClient(connection).sessions.prompt(
        resolvedSessionId,
        {
          promptId: entry.clientPromptId,
          blocks: entry.blocks,
        },
        requestOptions,
      );

      applySessionSummary(entry.clientSessionId, response.session, workspaceId);
      upsertWorkspaceSessionRecord(workspaceId, response.session);
      usePromptOutboxStore.getState().patchEntry(entry.clientPromptId, {
        deliveryState: response.status === "queued" ? "accepted_queued" : "accepted_running",
        placement: response.status === "queued" ? "queue" : "transcript",
        queuedSeq: response.queuedSeq ?? null,
        materializedSessionId: response.session.id,
        workspaceId,
        acceptedAt: new Date().toISOString(),
        errorMessage: null,
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
      const message = error instanceof Error ? error.message : "Prompt delivery failed.";
      usePromptOutboxStore.getState().patchEntry(entry.clientPromptId, {
        deliveryState: requestStarted ? "unknown_after_dispatch" : "failed_before_dispatch",
        errorMessage: message,
      });
      if (!requestStarted) {
        failLatencyFlow(entry.latencyFlowId, "prompt_dispatch_failed_before_request");
      }
    }
  }, [
    applySessionSummary,
    maybeGenerateSessionTitle,
    rehydrateSessionSlotFromHistory,
    upsertWorkspaceSessionRecord,
  ]);

  useEffect(() => {
    if (!isActiveDispatcherOwner(dispatcherOwnerRef.current)) {
      return;
    }

    const state = usePromptOutboxStore.getState();
    for (const clientSessionId of Object.keys(state.promptIdsByClientSessionId)) {
      if (inFlightSessionIdsRef.current.has(clientSessionId)) {
        continue;
      }
      const entry = selectNextDispatchableOutboxEntry(state, clientSessionId);
      if (!entry) {
        continue;
      }
      const record = getSessionRecord(clientSessionId);
      if (!record?.materializedSessionId) {
        continue;
      }
      inFlightSessionIdsRef.current.add(clientSessionId);
      void dispatchEntry(entry).finally(() => {
        inFlightSessionIdsRef.current.delete(clientSessionId);
      });
    }
  }, [dispatchEntry, dispatchVersion]);
}

function isActiveDispatcherOwner(owner: symbol | null): boolean {
  return owner !== null && activeDispatcherOwner === owner;
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
  rehydrateSessionSlotFromHistory: ReturnType<typeof useSessionRuntimeActions>["rehydrateSessionSlotFromHistory"];
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
  return Object.values(transcript.itemsById).some((item) =>
    item.kind === "user_message" && item.promptId === clientPromptId
  );
}
