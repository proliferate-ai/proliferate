import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import { routes } from "../../../config/routes";
import {
  isWorkspacePreparationStatus,
  workspaceFailureStatusMessage,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  findRecoverableSessionForPendingPrompt,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import { textMatches } from "../../../lib/domain/chat/cloud-chat-prompt-projection";
import {
  clearPendingHomePrompt,
  savePendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  resumeCloudSandboxPendingHomePrompt,
  startCloudSandboxPendingHomePrompt,
} from "../../../lib/access/anyharness/cloud-sandbox-pending-home-prompt";
import {
  type WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import {
  clearWebCloudSessionDraft,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";
import type { PendingHomePromptDispatchRun } from "./use-web-cloud-chat-local-state-lifecycle";

export function useWebCloudPendingHomePromptLifecycle(input: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail | null;
  workspaceStatus: string | null;
  workspaceAllowedAgentKindsKey: string;
  workspaceReadyAgentKindsKey: string;
  chatId: string | undefined;
  pendingHomePrompt: PendingHomePrompt | null;
  setPendingHomePrompt: Dispatch<SetStateAction<PendingHomePrompt | null>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setPendingSessionDraft: Dispatch<SetStateAction<WebCloudSessionDraft | null>>;
  pendingSessionDraft: WebCloudSessionDraft | null;
  routeSessionDraftId: string | null;
  pendingHomePromptDispatchRunRef: { current: PendingHomePromptDispatchRun | null };
  pendingHomePromptResumeAttemptsRef: { current: Set<string> };
  mountedRef: { current: boolean };
  directPromptDispatching: boolean;
  sessions: readonly CloudSessionProjection[];
  workspaceRefetch: () => void;
  navigate: NavigateFunction;
}) {
  const {
    client,
    productToken,
    workspace,
    workspaceStatus,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    chatId,
    pendingHomePrompt,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setDraft,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    mountedRef,
    directPromptDispatching,
    sessions,
    workspaceRefetch,
    navigate,
  } = input;

  useEffect(() => {
    if (!pendingHomePrompt || !workspace) {
      return;
    }
    const workspaceFailureMessage = workspaceFailureStatusMessage(workspace);
    if (pendingHomePrompt.status === "failed") {
      setPendingHomePromptStatus(
        workspaceFailureMessage
          ?? pendingHomePrompt.errorMessage
          ?? "Prompt could not be sent.",
      );
      setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      setPendingHomePromptStatus(
        workspaceFailureMessage ?? "Workspace creation failed before the prompt could be sent.",
      );
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }

    const runKey = `${workspace.id}:${pendingHomePrompt.id}`;
    const currentRun = pendingHomePromptDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run: PendingHomePromptDispatchRun = { key: runKey, active: true, started: false };
    pendingHomePromptDispatchRunRef.current = run;
    const isCurrentRun = () =>
      mountedRef.current && pendingHomePromptDispatchRunRef.current === run && run.active;
    const setCurrentStatus = (status: string) => {
      if (isCurrentRun()) {
        setPendingHomePromptStatus(status);
      }
    };

    setPendingHomePromptStatus("Starting a session for this prompt.");
    const timeoutId = window.setTimeout(() => {
      if (!isCurrentRun()) {
        return;
      }
      run.started = true;
      void startCloudSandboxPendingHomePrompt({
        client,
        productToken,
        workspace,
        pendingPrompt: pendingHomePrompt,
        onStatus: setCurrentStatus,
        shouldContinue: isCurrentRun,
      })
        .then((result) => {
          if (!isCurrentRun()) {
            return;
          }
          setOptimisticPrompts((current) =>
            current.some((prompt) => prompt.id === pendingHomePrompt.id)
              ? current
              : [
                ...current,
                {
                  id: pendingHomePrompt.id,
                  workspaceId: workspace.id,
                  sessionId: result.sessionId,
                  text: pendingHomePrompt.text,
                  baseTranscriptSeq: 0,
                  status: "queued",
                  createdAt: Date.now(),
                },
              ]
          );
          clearPendingHomePrompt(workspace.id);
          clearWebCloudSessionDraft(workspace.id, pendingSessionDraft?.id ?? routeSessionDraftId);
          setPendingSessionDraft(null);
          setPendingHomePrompt(null);
          setPendingHomePromptStatus(null);
          void workspaceRefetch();
          navigate(routes.chat(workspace.id, result.sessionId), { replace: true });
        })
        .catch((error: unknown) => {
          if (!isCurrentRun()) {
            return;
          }
          const message = error instanceof Error ? error.message : "Prompt could not be sent.";
          const prompt: PendingHomePrompt = isWorkspacePreparationStatus(message)
            ? { ...pendingHomePrompt, status: "pending", errorMessage: message }
            : { ...pendingHomePrompt, status: "failed", errorMessage: message };
          savePendingHomePrompt(workspace.id, prompt);
          setPendingHomePrompt(prompt);
          setPendingHomePromptStatus(message);
          setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
        })
        .finally(() => {
          if (pendingHomePromptDispatchRunRef.current === run) {
            pendingHomePromptDispatchRunRef.current = null;
          }
        });
    }, 0);
    return () => {
      if (!run.started) {
        run.active = false;
      }
      window.clearTimeout(timeoutId);
    };
  }, [
    client,
    navigate,
    pendingHomePrompt,
    pendingHomePromptDispatchRunRef,
    pendingSessionDraft?.id,
    productToken,
    routeSessionDraftId,
    setDraft,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    setPendingSessionDraft,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspaceStatus,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceRefetch,
  ]);

  useEffect(() => {
    if (
      !workspace
      || chatId
      || !pendingHomePrompt
      || pendingHomePrompt.status !== "failed"
      || directPromptDispatching
    ) {
      return;
    }
    const recoverableSession = findRecoverableSessionForPendingPrompt(sessions, pendingHomePrompt);
    if (!recoverableSession) {
      return;
    }
    const runKey = `${workspace.id}:${pendingHomePrompt.id}:resume:${recoverableSession.sessionId}`;
    if (pendingHomePromptResumeAttemptsRef.current.has(runKey)) {
      return;
    }
    const currentRun = pendingHomePromptDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    pendingHomePromptResumeAttemptsRef.current.add(runKey);
    const run: PendingHomePromptDispatchRun = { key: runKey, active: true, started: true };
    pendingHomePromptDispatchRunRef.current = run;
    const isCurrentRun = () =>
      mountedRef.current && pendingHomePromptDispatchRunRef.current === run && run.active;
    const setCurrentStatus = (status: string) => {
      if (isCurrentRun()) {
        setPendingHomePromptStatus(status);
      }
    };

    setPendingHomePromptStatus("Session started; sending prompt.");
    void resumeCloudSandboxPendingHomePrompt({
      client,
      productToken,
      workspace,
      session: recoverableSession,
      pendingPrompt: pendingHomePrompt,
      onStatus: setCurrentStatus,
      shouldContinue: isCurrentRun,
    })
      .then((result) => {
        if (!isCurrentRun()) {
          return;
        }
        setOptimisticPrompts((current) => {
          const updated = current.map((prompt) =>
            prompt.id === pendingHomePrompt.id
              ? {
                ...prompt,
                sessionId: result.sessionId,
                status: "queued" as const,
                errorMessage: null,
              }
              : prompt
          );
          return updated.some((prompt) => prompt.id === pendingHomePrompt.id)
            ? updated
            : [
              ...updated,
              {
                id: pendingHomePrompt.id,
                workspaceId: workspace.id,
                sessionId: result.sessionId,
                text: pendingHomePrompt.text,
                baseTranscriptSeq: 0,
                status: "queued",
                createdAt: Date.now(),
              },
            ];
        });
        clearPendingHomePrompt(workspace.id);
        setPendingHomePrompt(null);
        setPendingHomePromptStatus(null);
        setDraft((current) => textMatches(current, pendingHomePrompt.text) ? "" : current);
        void workspaceRefetch();
        navigate(routes.chat(workspace.id, result.sessionId), { replace: true });
      })
      .catch((error: unknown) => {
        if (!isCurrentRun()) {
          return;
        }
        const message = error instanceof Error ? error.message : "Prompt could not be sent.";
        const prompt: PendingHomePrompt = {
          ...pendingHomePrompt,
          status: "failed",
          errorMessage: message,
        };
        savePendingHomePrompt(workspace.id, prompt);
        setPendingHomePrompt(prompt);
        setPendingHomePromptStatus(message);
        setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
      })
      .finally(() => {
        if (pendingHomePromptDispatchRunRef.current === run) {
          pendingHomePromptDispatchRunRef.current = null;
        }
      });
    return () => {
      if (!run.started) {
        run.active = false;
      }
    };
  }, [
    chatId,
    client,
    directPromptDispatching,
    mountedRef,
    navigate,
    pendingHomePrompt,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    productToken,
    sessions,
    setDraft,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    workspace,
    workspaceRefetch,
  ]);
}
