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
  pendingConfigChangeKey,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
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
  clearWebCloudSessionDraft,
  createWebCloudSessionDraft,
  saveWebCloudSessionDraft,
  webCloudSessionDraftSearch,
  type WebCloudPromptIntent,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";
import { useWebCloudPlanDecisionActions } from "./use-web-cloud-plan-decision-actions";

type EnqueueCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export function useWebCloudChatActions(input: {
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
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  pendingConfigMutationIdRef: { current: number };
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  agentCatalog: Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
  workspaceLaunchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  sessionModelId: string | null;
  mountedRef: { current: boolean };
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  enqueuePrompt: EnqueueCommand<SendPromptPayload>;
  enqueueStartSession: EnqueueCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCommand<UpdateSessionConfigPayload>;
  enqueuePlanDecision: EnqueueCommand<{
    workspaceId: string;
    planId: string;
    decision: "approve" | "reject";
    expectedDecisionVersion: number;
  }>;
  workspaceRefetch: () => Promise<unknown> | unknown;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  claimWorkspace: {
    isPending: boolean;
    mutateAsync: (input: { workspaceId: string }) => Promise<unknown>;
  };
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
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    setLaunchSelection,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueuePrompt,
    enqueueStartSession,
    enqueueConfig,
    enqueuePlanDecision,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    claimWorkspace,
    navigate,
  } = input;
  const {
    activePlanDecision,
    setActivePlanDecision,
    transcriptPlanActions,
  } = useWebCloudPlanDecisionActions({
    client,
    workspace,
    session,
    isUnclaimed,
    resolvedAgentKind: resolvedLaunchSelection.agentKind,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    setPendingHomePromptStatus,
    enqueuePlanDecision,
    transcriptRefetch,
    sessionEventsRefetch,
  });

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

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before changing session settings.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    setPendingConfigChanges((current) => ({
      ...current,
      [changeKey]: {
        sessionId: session.sessionId,
        rawConfigId,
        value,
        status: "sending",
        mutationId,
      },
    }));
    try {
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolvedLaunchSelection.agentKind,
        modelId: sessionModelId,
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${mutationId}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueueConfig({
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: commandWorkspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "web",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        return {
          ...current,
          [changeKey]: { ...existing, commandId: command.commandId, status: "queued" },
        };
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  async function claimCurrentWorkspace() {
    if (!workspace || claimWorkspace.isPending) {
      return;
    }
    setPendingHomePromptStatus("Claiming workspace.");
    try {
      await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
      await workspaceRefetch();
      setPendingHomePromptStatus("Workspace claimed.");
    } catch (error) {
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Workspace could not be claimed.",
      );
    }
  }

  async function copyComposerFooterValue(value: string, label: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      console.warn(`${label} could not be copied.`);
      return false;
    }
  }

  function openNewSessionDraft(selection: CloudLaunchComposerSelection = resolvedLaunchSelection) {
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
    if (pendingSessionDraft) {
      clearWebCloudSessionDraft(workspace.id, pendingSessionDraft.id);
    }
    const resolvedSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection,
    });
    const draft = createWebCloudSessionDraft({
      workspaceId: workspace.id,
      selection: resolvedSelection,
      sessionConfigUpdates: buildLaunchSessionConfigUpdates({
        catalog: agentCatalog,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: resolvedSelection,
      }),
    });
    saveWebCloudSessionDraft(draft);
    setPendingSessionDraft(draft);
    setLaunchSelection(resolvedSelection);
    setPendingConfigChanges({});
    setPendingHomePromptStatus(null);
    navigate(`${routes.workspace(workspace.id)}${webCloudSessionDraftSearch(draft.id)}`);
  }

  return {
    activePlanDecision,
    setActivePlanDecision,
    submitPrompt,
    submitSessionConfig,
    transcriptPlanActions,
    claimCurrentWorkspace,
    copyComposerFooterValue,
    openNewSessionDraft,
  };
}
