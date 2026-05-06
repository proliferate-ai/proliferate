import { useCallback, useEffect, useRef } from "react";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import {
  selectNextDispatchableOutboxEntry,
  type PromptOutboxEntry,
} from "@/lib/domain/chat/prompt-outbox";
import {
  promptAttachmentSnapshotsToBlocks,
} from "@/lib/domain/chat/prompt-attachment-snapshot";
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
    let requestHeaders: HeadersInit | null = null;
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
      const preparedBlocks = await preparePromptBlocks(latestBeforeDispatch);
      const latestAfterPrepare = usePromptOutboxStore
        .getState()
        .entriesByPromptId[entry.clientPromptId];
      if (!latestAfterPrepare || latestAfterPrepare.deliveryState !== "preparing") {
        return;
      }
      const {
        connection,
        workspaceId,
        materializedSessionId: resolvedSessionId,
      } = await getSessionClientAndWorkspace(entry.clientSessionId);
      requestHeaders = getLatencyFlowRequestHeaders(entry.latencyFlowId) ?? null;
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
          blocks: preparedBlocks,
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
      const failure = classifyPromptDispatchFailure(error, requestStarted);
      usePromptOutboxStore.getState().patchEntry(entry.clientPromptId, {
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

export function classifyPromptDispatchFailure(
  error: unknown,
  requestStarted: boolean,
): {
  deliveryState: "failed_before_dispatch" | "unknown_after_dispatch";
  message: string;
} {
  if (!requestStarted) {
    return {
      deliveryState: "failed_before_dispatch",
      message: sanitizePromptDispatchErrorMessage(error),
    };
  }
  const status = readErrorStatus(error);
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return {
      deliveryState: "failed_before_dispatch",
      message: sanitizePromptDispatchErrorMessage(error),
    };
  }
  return {
    deliveryState: "unknown_after_dispatch",
    message: sanitizePromptDispatchErrorMessage(error),
  };
}

function sanitizePromptDispatchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Prompt delivery failed.";
}

function readErrorStatus(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== "object" || depth > 2) {
    return null;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    problem?: { status?: unknown };
    response?: { status?: unknown };
    cause?: unknown;
  };
  if (typeof candidate.status === "number") {
    return candidate.status;
  }
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  if (typeof candidate.problem?.status === "number") {
    return candidate.problem.status;
  }
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }
  return readErrorStatus(candidate.cause, depth + 1);
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
