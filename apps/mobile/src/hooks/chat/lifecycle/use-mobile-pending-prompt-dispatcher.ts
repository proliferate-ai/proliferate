import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import { savePendingMobilePrompt } from "../../../lib/access/cloud/pending-mobile-prompt-store";
import {
  dispatchPendingMobilePrompt,
  rearmRetryablePendingMobilePrompt,
  RetryablePendingPromptDispatchError,
  shouldRetryPendingMobilePromptFailure,
  type SendPromptPayload,
  type StartSessionPayload,
  type UpdateSessionConfigPayload,
} from "../../../lib/access/cloud/pending-mobile-prompt-dispatch";
import type { EnqueueCloudCommand } from "../../../lib/access/cloud/pending-mobile-prompt-types";
import {
  markPendingPromptFailed,
} from "../../../lib/domain/chat/mobile-chat-transcript";

export function useMobilePendingPromptDispatcher({
  client,
  enqueueStartSession,
  enqueueConfig,
  enqueuePrompt,
  ownerUserId,
  pendingPrompt,
  pendingPromptDurable,
  pendingPromptFailed,
  invalidateWorkspaceLists,
  workspace,
  workspaceStatus,
  workspaceRefetch,
  pendingDispatchRunRef,
  onSessionSelected,
  setLatestCommandId,
  setNewSessionMode,
  setSelectedSessionId,
  setPendingPrompt,
  setPendingPromptStatus,
  setPendingPromptFailed,
}: {
  client: ProliferateCloudClient;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  ownerUserId: string | null;
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptDurable: boolean;
  pendingPromptFailed: boolean;
  invalidateWorkspaceLists: () => void;
  workspace: CloudWorkspaceDetail | null;
  workspaceStatus: string;
  workspaceRefetch: () => void | Promise<unknown>;
  pendingDispatchRunRef: MutableRefObject<{ key: string; active: boolean } | null>;
  onSessionSelected?: (sessionId: string) => void;
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  setNewSessionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
  setPendingPromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingPromptFailed: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!pendingPrompt || !workspace || pendingPromptFailed) {
      return;
    }
    if (pendingPrompt.dispatchedSessionId && pendingPromptDurable) {
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      const message = "Workspace creation failed before the prompt could be sent.";
      const failedPrompt = markPendingPromptFailed(pendingPrompt, message, Date.now());
      setPendingPrompt(failedPrompt);
      setPendingPromptStatus(message);
      setPendingPromptFailed(true);
      if (ownerUserId) {
        void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
      }
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingPromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId) {
      setPendingPromptStatus(
        workspace.actionBlockReason || "Managed target configuration is still materializing.",
      );
      return;
    }
    if (pendingPrompt.dispatchedSessionId && pendingPrompt.sendCommandId) {
      setNewSessionMode(false);
      setSelectedSessionId(pendingPrompt.dispatchedSessionId);
      onSessionSelected?.(pendingPrompt.dispatchedSessionId);
      setLatestCommandId(pendingPrompt.sendCommandId);
      setPendingPromptStatus("Queued prompt; waiting for transcript.");
      setPendingPromptFailed(false);
      return;
    }

    const runKey = `${workspace.id}:${pendingPrompt.id}`;
    const currentRun = pendingDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run = { key: runKey, active: true };
    pendingDispatchRunRef.current = run;
    const isCurrentRun = () => pendingDispatchRunRef.current === run && run.active;
    let startedSessionId: string | null = pendingPrompt.dispatchedSessionId ?? null;
    let enqueuedSendCommandId: string | null = pendingPrompt.sendCommandId ?? null;
    setPendingPromptStatus("Starting a session for the queued prompt.");
    setPendingPromptFailed(false);

    void dispatchPendingMobilePrompt({
      client,
      workspace,
      pendingPrompt,
      modelId: pendingPrompt.modelId,
      enqueueStartSession,
      enqueueConfig,
      enqueuePrompt,
      setLatestCommandId: (commandId) => {
        if (isCurrentRun()) {
          setLatestCommandId(commandId);
        }
      },
      onSessionStarted: (sessionId) => {
        if (!isCurrentRun()) {
          return;
        }
        startedSessionId = sessionId;
        const dispatchedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: sessionId,
          failedAt: null,
          failureMessage: null,
        };
        setNewSessionMode(false);
        setSelectedSessionId(sessionId);
        onSessionSelected?.(sessionId);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, dispatchedPrompt);
        }
      },
      onPromptEnqueued: (commandId) => {
        if (!isCurrentRun() || !startedSessionId) {
          return;
        }
        enqueuedSendCommandId = commandId;
        const enqueuedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: startedSessionId,
          sendCommandId: commandId,
          failedAt: null,
          failureMessage: null,
        };
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, enqueuedPrompt);
        }
      },
      onStatus: (status) => {
        if (isCurrentRun()) {
          setPendingPromptStatus(status);
        }
      },
      shouldContinue: isCurrentRun,
    })
      .then((result) => {
        if (!isCurrentRun()) {
          return;
        }
        const dispatchedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: result.sessionId,
          sendCommandId: result.sendCommandId,
          failedAt: null,
          failureMessage: null,
        };
        setNewSessionMode(false);
        setSelectedSessionId(result.sessionId);
        onSessionSelected?.(result.sessionId);
        setPendingPrompt(dispatchedPrompt);
        setPendingPromptStatus(null);
        setPendingPromptFailed(false);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, dispatchedPrompt);
        }
        void workspaceRefetch();
        invalidateWorkspaceLists();
      })
      .catch((error: unknown) => {
        if (!isCurrentRun()) {
          return;
        }
        const message = error instanceof Error ? error.message : "Queued prompt could not be sent.";
        if (error instanceof RetryablePendingPromptDispatchError) {
          setPendingPromptStatus(message);
          if (shouldRetryPendingMobilePromptFailure(pendingPrompt)) {
            const retryingPrompt = rearmRetryablePendingMobilePrompt(pendingPrompt);
            setPendingPrompt(retryingPrompt);
            setPendingPromptFailed(false);
            if (ownerUserId) {
              void savePendingMobilePrompt(workspace.id, ownerUserId, retryingPrompt);
            }
          }
          setTimeout(() => {
            if (!run.active) {
              return;
            }
            setPendingPrompt((current) =>
              current?.id === pendingPrompt.id ? { ...current } : current
            );
          }, 2500);
          return;
        }
        const failedPrompt = markPendingPromptFailed(
          startedSessionId
            ? {
                ...pendingPrompt,
                dispatchedSessionId: startedSessionId,
                sendCommandId: enqueuedSendCommandId,
              }
            : pendingPrompt,
          message,
          Date.now(),
        );
        setPendingPrompt(failedPrompt);
        setPendingPromptStatus(message);
        setPendingPromptFailed(true);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
        }
      })
      .finally(() => {
        if (pendingDispatchRunRef.current === run) {
          pendingDispatchRunRef.current = null;
        }
      });

    return () => {
      run.active = false;
    };
  }, [
    client,
    enqueuePrompt,
    enqueueStartSession,
    ownerUserId,
    pendingPrompt,
    pendingPromptDurable,
    pendingPromptFailed,
    invalidateWorkspaceLists,
    workspace?.actionBlockReason,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspace?.targetId,
    workspaceStatus,
    workspaceRefetch,
  ]);
}
