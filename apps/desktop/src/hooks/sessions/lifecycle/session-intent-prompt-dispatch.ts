import type { Session } from "@anyharness/sdk";
import type { usePromptSessionMutation } from "@anyharness/sdk-react";
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
} from "@proliferate/product-domain/sessions/intents/prompt-dispatch-failure";
import {
  transcriptHasRenderablePromptEcho,
} from "@proliferate/product-domain/sessions/intents/prompt-echo";
import {
  isOutboxEntryTerminal,
  type PromptOutboxEntry,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import {
  getSessionClientAndWorkspace,
} from "@/lib/access/anyharness/session-runtime";
import { sendCloudPromptCommand } from "@/lib/access/cloud/session-commands";
import {
  waitForSessionMaterialization,
} from "@/lib/workflows/sessions/session-materialization";
import {
  sessionMaterializationDeps,
} from "@/hooks/sessions/workflows/session-materialization-deps";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

const SESSION_READY_TIMEOUT_MS = 5_000;
const ACCEPTED_RUNNING_RECONCILE_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000] as const;
const ACCEPTED_RUNNING_RECONCILE_TIMEOUT_MS = 3_000;

type PromptSessionMutation = ReturnType<typeof usePromptSessionMutation>;

export interface PromptIntentDispatchDeps {
  applySessionSummary: (clientSessionId: string, session: Session, workspaceId: string) => void;
  maybeGenerateSessionTitle: (input: {
    sessionId: string;
    firstUserMessage: string;
  }) => Promise<void> | void;
  promptSessionMutation: PromptSessionMutation;
  rehydrateSessionSlotFromHistory: (
    sessionId: string,
    options?: {
      afterSeq?: number;
      limit?: number;
      requestHeaders?: HeadersInit;
      timeoutMs?: number;
    },
  ) => Promise<boolean>;
  upsertWorkspaceSessionRecord: (workspaceId: string, session: Session) => void;
}

export async function dispatchPromptIntent(
  entry: PromptOutboxEntry,
  deps: PromptIntentDispatchDeps,
): Promise<void> {
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
      target,
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
    let response;
    if (target.location === "cloud") {
      if (!target.cloudWorkspaceId || !target.targetId) {
        throw new Error("Cloud workspace is missing command routing metadata.");
      }
      response = await sendCloudPromptCommand({
        idempotencyKey: `desktop:send-prompt:${target.cloudWorkspaceId}:${resolvedSessionId}:${entry.clientPromptId}`,
        targetId: target.targetId,
        cloudWorkspaceId: target.cloudWorkspaceId,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
        sessionId: resolvedSessionId,
        promptId: entry.clientPromptId,
        blocks: preparedBlocks,
        text: entry.text,
      });
    } else {
      response = await deps.promptSessionMutation.mutateAsync({
        workspaceId,
        sessionId: resolvedSessionId,
        request: {
          promptId: entry.clientPromptId,
          blocks: preparedBlocks,
        },
        requestOptions,
      });
    }
    if (!response) {
      throw new Error("Cloud prompt command completed without a prompt response.");
    }

    deps.applySessionSummary(entry.clientSessionId, response.session, workspaceId);
    deps.upsertWorkspaceSessionRecord(workspaceId, response.session);
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
        rehydrateSessionSlotFromHistory: deps.rehydrateSessionSlotFromHistory,
      });
    }

    if (shouldGenerateTitle) {
      void deps.maybeGenerateSessionTitle({
        sessionId: entry.clientSessionId,
        firstUserMessage: entry.text,
      });
    }
  } catch (error) {
    const failure = classifyPromptDispatchFailure(error, requestStarted);
    const latestAfterFailure = useSessionIntentStore.getState().entriesById[entry.intentId];
    if (!latestAfterFailure || latestAfterFailure.kind !== "send_prompt") {
      return;
    }
    if (isOutboxEntryTerminal(latestAfterFailure)) {
      return;
    }
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
        rehydrateSessionSlotFromHistory: deps.rehydrateSessionSlotFromHistory,
      });
    }
  }
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
  rehydrateSessionSlotFromHistory: PromptIntentDispatchDeps["rehydrateSessionSlotFromHistory"];
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
