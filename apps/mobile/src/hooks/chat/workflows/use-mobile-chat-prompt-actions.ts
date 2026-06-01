import { useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { latestCloudTranscriptSeq } from "@proliferate/product-domain/chats/cloud/transcript-view";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import { savePendingMobilePrompt } from "../../../lib/access/cloud/pending-mobile-prompt-store";
import type {
  SendPromptPayload,
} from "../../../lib/access/cloud/pending-mobile-prompt-types";
import { ensureMobileWorkspaceReadyForCloudCommands } from "../../../lib/access/cloud/pending-mobile-workspace-readiness";
import type { OptimisticPrompt } from "../../../lib/domain/chat/mobile-chat-transcript";
import { resolveAgentKind } from "../../../lib/domain/chat/mobile-chat-presentation";

type EnqueuePromptMutation = {
  isPending: boolean;
  mutateAsync: (
    command: CloudCommandEnvelope<SendPromptPayload>,
  ) => Promise<CloudCommandResponse>;
};

type CloudLaunchCatalog = Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
type CloudLaunchableAgentKinds = Parameters<typeof resolveCloudLaunchSelection>[0]["launchableAgentKinds"];

export function useMobileChatPromptActions({
  ownerUserId,
  client,
  enqueuePrompt,
  workspace,
  session,
  draft,
  pendingPrompt,
  pendingPromptFailed,
  hasActiveOptimisticPrompt,
  isUnclaimed,
  canStartNewSession,
  workspaceHarnessAvailabilityMessage,
  workspaceLaunchableAgentKinds,
  resolvedLaunchSelection,
  catalog,
  sessionModelId,
  transcriptItems,
  transcriptRows,
  setDraft,
  setPendingPrompt,
  setPendingPromptStatus,
  setPendingPromptFailed,
  setOptimisticPrompts,
  setLatestCommandId,
  transcriptRefetch,
  sessionEventsRefetch,
}: {
  ownerUserId: string | null;
  client: ProliferateCloudClient;
  enqueuePrompt: EnqueuePromptMutation;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  draft: string;
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptFailed: boolean;
  hasActiveOptimisticPrompt: boolean;
  isUnclaimed: boolean;
  canStartNewSession: boolean;
  workspaceHarnessAvailabilityMessage?: string | null;
  workspaceLaunchableAgentKinds: CloudLaunchableAgentKinds;
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  catalog: CloudLaunchCatalog;
  sessionModelId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  setDraft: Dispatch<SetStateAction<string>>;
  setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
  setPendingPromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingPromptFailed: Dispatch<SetStateAction<boolean>>;
  setOptimisticPrompts: Dispatch<SetStateAction<OptimisticPrompt[]>>;
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  transcriptRefetch: () => void | Promise<unknown>;
  sessionEventsRefetch: () => void | Promise<unknown>;
}) {
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const directPromptDispatchingRef = useRef(false);
  const sessionPromptDispatchingRef = useRef(false);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingPromptStatus("Claim this workspace before sending prompts from mobile.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingPromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    if (!session) {
      await submitPendingSessionPrompt(text);
      return;
    }
    await submitExistingSessionPrompt(text, session);
  }

  async function submitPendingSessionPrompt(text: string) {
    if (!ownerUserId) {
      setPendingPromptStatus("Account is still loading. Try again in a moment.");
      return;
    }
    if (!workspace) {
      return;
    }
    if (directPromptDispatchingRef.current || (pendingPrompt && !pendingPromptFailed)) {
      return;
    }
    if (!canStartNewSession) {
      setPendingPromptStatus(
        workspaceHarnessAvailabilityMessage ?? "No cloud agent is ready for a new session.",
      );
      return;
    }
    const promptSelection = resolveCloudLaunchSelection({
      catalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: resolvedLaunchSelection,
    });
    directPromptDispatchingRef.current = true;
    const prompt: MobilePendingPrompt = {
      id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
      text,
      agentKind: promptSelection.agentKind,
      modelId: promptSelection.modelId,
      modeId: promptSelection.modeId,
      sessionConfigUpdates: buildLaunchSessionConfigUpdates({
        catalog,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: promptSelection,
      }),
      createdAt: Date.now(),
    };
    setDraft("");
    setPendingPrompt(prompt);
    setPendingPromptStatus("Starting a session for this prompt.");
    setPendingPromptFailed(false);
    setDirectPromptDispatching(true);
    try {
      await savePendingMobilePrompt(workspace.id, ownerUserId, prompt);
    } catch (error) {
      setPendingPromptStatus(
        error instanceof Error
          ? `Prompt will send while this chat stays open. Storage failed: ${error.message}`
          : "Prompt will send while this chat stays open, but could not be saved.",
      );
    } finally {
      directPromptDispatchingRef.current = false;
      setDirectPromptDispatching(false);
    }
  }

  async function submitExistingSessionPrompt(
    text: string,
    activeSession: CloudSessionProjection,
  ) {
    if (!workspace) {
      return;
    }
    if (sessionPromptDispatchingRef.current || hasActiveOptimisticPrompt) {
      return;
    }
    sessionPromptDispatchingRef.current = true;
    const optimisticPrompt: OptimisticPrompt = {
      id: `mobile:${workspace.id}:${activeSession.sessionId}:${Date.now()}`,
      sessionId: activeSession.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptRows),
      status: "sending",
    };
    setOptimisticPrompts((current) => [...current, optimisticPrompt]);
    setDraft("");
    setPendingPromptStatus(null);
    try {
      await ensureMobileWorkspaceReadyForCloudCommands({
        client,
        workspace,
        agentKind: activeSession.sourceAgentKind ?? resolveAgentKind(workspace),
        modelId: sessionModelId,
        idempotencyKey: `${optimisticPrompt.id}:target-config`,
        setLatestCommandId,
        onStatus: setPendingPromptStatus,
        shouldContinue: () => sessionPromptDispatchingRef.current,
      });
      const command = await enqueuePrompt.mutateAsync({
        idempotencyKey: optimisticPrompt.id,
        targetId: activeSession.targetId,
        workspaceId: activeSession.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: activeSession.sessionId,
        kind: "send_prompt",
        source: "mobile",
        payload: { text, promptId: optimisticPrompt.id },
      });
      setLatestCommandId(command.commandId);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, commandId: command.commandId, status: "queued" }
            : prompt
        )
      );
      void transcriptRefetch();
      void sessionEventsRefetch();
    } catch (error) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setPendingPromptStatus(error instanceof Error ? error.message : "Prompt could not be sent.");
    } finally {
      sessionPromptDispatchingRef.current = false;
    }
  }

  return {
    promptSubmitting:
      enqueuePrompt.isPending
      || directPromptDispatching
      || (Boolean(pendingPrompt) && !pendingPromptFailed)
      || hasActiveOptimisticPrompt,
    submitPrompt,
  };
}
