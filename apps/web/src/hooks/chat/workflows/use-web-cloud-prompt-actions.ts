import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  latestCloudTranscriptSeq,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { routes } from "../../../config/routes";
import {
  commandStatusFailureMessage,
  isRejectedCommandStatus,
  isWorkspacePreparationStatus,
  promptCommandFailureMessage,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import { removeRetryReplacedFailedPrompts } from "../../../lib/domain/chat/cloud-chat-prompt-projection";
import {
  dispatchPendingHomePrompt,
  enqueuePromptCommandWithRetry,
  prepareManagedWorkspaceForCloudCommands,
  type SendPromptPayload,
  type StartSessionPayload,
  type UpdateSessionConfigPayload,
} from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import {
  clearPendingHomePrompt,
  savePendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  type WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import {
  clearWebCloudSessionDraft,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";

type EnqueueCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export function useWebCloudPromptActions(input: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  isUnclaimed: boolean;
  canStartNewSession: boolean;
  workspaceStatus: string | null;
  workspaceHarnessAvailability: { message?: string | null };
  directPromptDispatching: boolean;
  setDirectPromptDispatching: Dispatch<SetStateAction<boolean>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  setPendingHomePrompt: Dispatch<SetStateAction<PendingHomePrompt | null>>;
  setPendingSessionDraft: Dispatch<SetStateAction<WebCloudSessionDraft | null>>;
  pendingSessionDraft: WebCloudSessionDraft | null;
  routeSessionDraftId: string | null;
  agentCatalog: Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
  workspaceLaunchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  sessionModelId: string | null;
  mountedRef: { current: boolean };
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  enqueuePrompt: EnqueueCommand<SendPromptPayload>;
  enqueueStartSession: EnqueueCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCommand<UpdateSessionConfigPayload>;
  workspaceRefetch: () => Promise<unknown> | unknown;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  navigate: NavigateFunction;
}) {
  const {
    client,
    workspace,
    session,
    draft,
    setDraft,
    isUnclaimed,
    canStartNewSession,
    workspaceStatus,
    workspaceHarnessAvailability,
    directPromptDispatching,
    setDirectPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueuePrompt,
    enqueueStartSession,
    enqueueConfig,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    navigate,
  } = input;

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before sending prompts.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    if (!session) {
      await submitPromptToNewSession(text);
      return;
    }
    await submitPromptToExistingSession(text, session);
  }

  async function submitPromptToNewSession(text: string) {
    if (!workspace) {
      return;
    }
    if (!canStartNewSession) {
      setPendingHomePromptStatus(
        workspaceHarnessAvailability.message
          ?? "No cloud agent is ready to start a new session in this workspace.",
      );
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (directPromptDispatching) {
      return;
    }
    const promptId = `web-chat:${workspace.id}:${Date.now().toString(36)}`;
    const optimisticPrompt: WebCloudPromptIntent = {
      id: promptId,
      workspaceId: workspace.id,
      sessionId: null,
      text,
      baseTranscriptSeq: 0,
      status: "sending",
      createdAt: Date.now(),
    };
    setOptimisticPrompts((current) => [
      ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
      optimisticPrompt,
    ]);
    setDraft("");
    setDirectPromptDispatching(true);
    setPendingHomePromptStatus("Starting a session for this prompt.");
    const promptSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: pendingSessionDraft?.selection ?? resolvedLaunchSelection,
    });
    const promptConfigUpdates = pendingSessionDraft?.sessionConfigUpdates
      ?? buildLaunchSessionConfigUpdates({
        catalog: agentCatalog,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: promptSelection,
      });
    const pendingPrompt: PendingHomePrompt = {
      id: promptId,
      text,
      agentKind: promptSelection.agentKind,
      modelId: promptSelection.modelId,
      modeId: promptSelection.modeId,
      sessionConfigUpdates: promptConfigUpdates,
      createdAt: Date.now(),
    };
    savePendingHomePrompt(workspace.id, pendingPrompt);
    try {
      const result = await dispatchPendingHomePrompt({
        client,
        workspace,
        pendingPrompt,
        modelId: pendingPrompt.modelId,
        enqueueStartSession,
        enqueueConfig,
        enqueuePrompt,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? {
              ...prompt,
              sessionId: result.sessionId,
              status: "queued",
              commandId: result.sendCommandId,
            }
            : prompt
        )
      );
      clearPendingHomePrompt(workspace.id);
      clearWebCloudSessionDraft(workspace.id, pendingSessionDraft?.id ?? routeSessionDraftId);
      setPendingSessionDraft(null);
      setPendingHomePrompt(null);
      setPendingHomePromptStatus(null);
      await workspaceRefetch();
      navigate(routes.chat(workspace.id, result.sessionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Prompt could not be sent.";
      const isPreparing = isWorkspacePreparationStatus(message);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, status: isPreparing ? "queued" : "failed" }
            : prompt
        )
      );
      setDraft((current) => current.trim() ? current : text);
      const prompt: PendingHomePrompt = {
        ...pendingPrompt,
        status: isPreparing ? "pending" : "failed",
        errorMessage: message,
      };
      savePendingHomePrompt(workspace.id, prompt);
      setPendingHomePrompt(prompt);
      setPendingHomePromptStatus(message);
    } finally {
      setDirectPromptDispatching(false);
    }
  }

  async function submitPromptToExistingSession(text: string, activeSession: CloudSessionProjection) {
    if (!workspace) {
      return;
    }
    const optimisticPrompt: WebCloudPromptIntent = {
      id: `web:${workspace.id}:${activeSession.sessionId}:${Date.now()}`,
      workspaceId: workspace.id,
      sessionId: activeSession.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptRows),
      status: "sending",
      createdAt: Date.now(),
    };
    setOptimisticPrompts((current) => [
      ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
      optimisticPrompt,
    ]);
    setDraft("");
    setPendingHomePromptStatus(null);
    try {
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: activeSession.sourceAgentKind ?? resolvedLaunchSelection.agentKind,
        modelId: sessionModelId,
        idempotencyKey: `${optimisticPrompt.id}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueuePromptCommandWithRetry({
        envelope: {
          idempotencyKey: optimisticPrompt.id,
          targetId: activeSession.targetId,
          workspaceId: activeSession.workspaceId,
          cloudWorkspaceId: commandWorkspace.id,
          sessionId: activeSession.sessionId,
          kind: "send_prompt",
          source: "web",
          payload: { text, promptId: optimisticPrompt.id },
        },
        enqueuePrompt,
        shouldContinue: () => mountedRef.current,
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      if (isRejectedCommandStatus(command.status)) {
        throw new Error(
          commandStatusFailureMessage(command, promptCommandFailureMessage(command.status))
            ?? promptCommandFailureMessage(command.status),
        );
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, commandId: command.commandId, status: "queued" }
            : prompt
        )
      );
      setPendingHomePromptStatus(null);
      void transcriptRefetch();
      void sessionEventsRefetch();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setDraft((current) => current.trim() ? current : text);
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Prompt could not be sent.",
      );
    }
  }

  return { submitPrompt };
}
