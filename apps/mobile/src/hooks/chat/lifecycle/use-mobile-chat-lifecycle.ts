import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudCommandStatus,
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  getLiveConfigControlValue,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  cloudTranscriptHasAgentProgressAfterPrompt,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../../navigation/navigation-model";
import {
  clearPendingMobilePrompt,
  savePendingMobilePrompt,
} from "../../../lib/access/cloud/pending-mobile-prompt-store";
import {
  type SendPromptPayload,
  type StartSessionPayload,
  type UpdateSessionConfigPayload,
} from "../../../lib/access/cloud/pending-mobile-prompt-dispatch";
import {
  failedPendingInteractionForPendingPrompt,
  failedPendingInteractionMessage,
  markPendingPromptFailed,
  type OptimisticPrompt,
} from "../../../lib/domain/chat/mobile-chat-transcript";
import {
  isRejectedCommandStatus,
  isTerminalCommandStatus,
  sessionConfigCommandFailureMessage,
  promptCommandFailureMessage,
} from "../../../lib/domain/chat/mobile-chat-presentation";
import { useMobilePendingPromptDispatcher } from "./use-mobile-pending-prompt-dispatcher";
import { useMobilePendingPromptRestore } from "./use-mobile-pending-prompt-restore";

type EnqueueCloudCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

type CommandStatusView = {
  commandId: string;
  status: CloudCommandStatus;
  errorMessage?: string | null;
} | null | undefined;

export function useMobileChatLifecycle({
  chat,
  ownerUserId,
  onInitialPendingPromptConsumed,
  onSessionSelected,
  client,
  invalidateWorkspaceLists,
  workspace,
  workspaceStatus,
  workspaceRefetch,
  session,
  targetId,
  sessionLiveLastPatchAt,
  transcriptRefetch,
  sessionEventsRefetch,
  transcriptItems,
  transcriptRows,
  pendingInteractions,
  pendingPrompt,
  pendingPromptFailed,
  pendingPromptDurable,
  hasActiveOptimisticPrompt,
  optimisticPrompts,
  liveConfig,
  configCommand,
  promptCommand,
  pendingPromptCommandId,
  pendingConfigChanges,
  pendingDispatchRunRef,
  enqueueStartSession,
  enqueueConfig,
  enqueuePrompt,
  setDraft,
  setSelectedSessionId,
  setNewSessionMode,
  setLatestCommandId,
  setLatestConfigCommandId,
  setPendingPrompt,
  setPendingPromptStatus,
  setPendingPromptFailed,
  setOptimisticPrompts,
  setPendingConfigChanges,
  setClaimedLocally,
  resetPermissionSheet,
}: {
  chat: MobileCloudChat;
  ownerUserId: string | null;
  onInitialPendingPromptConsumed?: () => void;
  onSessionSelected?: (sessionId: string) => void;
  client: ProliferateCloudClient;
  invalidateWorkspaceLists: () => void;
  workspace: CloudWorkspaceDetail | null;
  workspaceStatus: string;
  workspaceRefetch: () => void | Promise<unknown>;
  session: CloudSessionProjection | null;
  targetId: string | null;
  sessionLiveLastPatchAt: unknown;
  transcriptRefetch: () => void | Promise<unknown>;
  sessionEventsRefetch: () => void | Promise<unknown>;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  pendingInteractions: readonly CloudPendingInteraction[];
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptFailed: boolean;
  pendingPromptDurable: boolean;
  hasActiveOptimisticPrompt: boolean;
  optimisticPrompts: readonly OptimisticPrompt[];
  liveConfig: Parameters<typeof getLiveConfigControlValue>[0] | null;
  configCommand: CommandStatusView;
  promptCommand: CommandStatusView;
  pendingPromptCommandId: string | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  pendingDispatchRunRef: MutableRefObject<{ key: string; active: boolean } | null>;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  setDraft: Dispatch<SetStateAction<string>>; setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setNewSessionMode: Dispatch<SetStateAction<boolean>>; setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  setLatestConfigCommandId: Dispatch<SetStateAction<string | null>>; setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
  setPendingPromptStatus: Dispatch<SetStateAction<string | null>>; setPendingPromptFailed: Dispatch<SetStateAction<boolean>>;
  setOptimisticPrompts: Dispatch<SetStateAction<OptimisticPrompt[]>>; setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  setClaimedLocally: Dispatch<SetStateAction<boolean>>;
  resetPermissionSheet: () => void;
}) {
  useEffect(() => {
    setSelectedSessionId(chat.sessionId);
    setDraft("");
    setNewSessionMode(false);
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    setOptimisticPrompts([]);
    setPendingConfigChanges({});
    setLatestConfigCommandId(null);
    setClaimedLocally(false);
    resetPermissionSheet();
  }, [chat.workspaceId, chat.sessionId]);

  useMobilePendingPromptRestore({
    chat,
    ownerUserId,
    onInitialPendingPromptConsumed,
    onSessionSelected,
    setPendingPrompt,
    setPendingPromptFailed,
    setPendingPromptStatus,
    setSelectedSessionId,
    setNewSessionMode,
  });

  useEffect(() => {
    if (!workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = setInterval(() => {
      void workspaceRefetch();
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceRefetch]);

  useEffect(() => {
    if (!session || !sessionLiveLastPatchAt) {
      return;
    }
    void transcriptRefetch();
    void sessionEventsRefetch();
  }, [session?.sessionId, sessionEventsRefetch, sessionLiveLastPatchAt, transcriptRefetch]);

  useEffect(() => {
    if (!pendingPrompt && !hasActiveOptimisticPrompt) {
      return;
    }
    const interval = setInterval(() => {
      void workspaceRefetch();
      if (session && targetId) {
        void transcriptRefetch();
        void sessionEventsRefetch();
      }
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [hasActiveOptimisticPrompt, pendingPrompt, session?.sessionId, sessionEventsRefetch, targetId, transcriptRefetch, workspaceRefetch]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setOptimisticPrompts((current) =>
      current.filter((prompt) =>
        prompt.sessionId !== session.sessionId
        || prompt.status === "failed"
        || !cloudTranscriptHasAgentProgressAfterPrompt({
          prompt,
          transcriptItems,
          transcriptRows,
        })
      )
    );
  }, [session?.sessionId, transcriptItems, transcriptRows, setOptimisticPrompts]);

  useEffect(() => {
    if (!session || !liveConfig) {
      return;
    }
    setPendingConfigChanges((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, pendingChange] of Object.entries(current)) {
        if (pendingChange.sessionId !== session.sessionId) {
          continue;
        }
        if (getLiveConfigControlValue(liveConfig, pendingChange.rawConfigId) === pendingChange.value) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [liveConfig, session?.sessionId, setPendingConfigChanges]);

  useEffect(() => {
    const command = configCommand;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (
      !Object.values(pendingConfigChanges).some((change) =>
        change.commandId === command.commandId
      )
    ) {
      return;
    }
    setPendingConfigChanges((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([_key, change]) =>
          change.commandId !== command.commandId
        ),
      )
    );
    setPendingPromptStatus(command.errorMessage || sessionConfigCommandFailureMessage(command.status));
  }, [configCommand?.commandId, configCommand?.errorMessage, configCommand?.status, pendingConfigChanges, setPendingConfigChanges, setPendingPromptStatus]);

  useEffect(() => {
    const command = promptCommand;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (!optimisticPrompts.some((prompt) =>
      prompt.commandId === command.commandId && prompt.status !== "failed"
    )) {
      return;
    }
    setOptimisticPrompts((current) =>
      current.map((prompt) =>
        prompt.commandId === command.commandId && prompt.status !== "failed"
          ? { ...prompt, status: "failed" }
          : prompt
      ),
    );
    setPendingPromptStatus(command.errorMessage || promptCommandFailureMessage(command.status));
  }, [promptCommand?.commandId, promptCommand?.errorMessage, promptCommand?.status, optimisticPrompts, setOptimisticPrompts, setPendingPromptStatus]);

  useEffect(() => {
    if (!pendingPrompt || pendingPromptFailed || pendingPrompt.failedAt) {
      return;
    }
    const failedInteraction = failedPendingInteractionForPendingPrompt(
      pendingPrompt,
      pendingInteractions,
    );
    if (!failedInteraction) {
      return;
    }
    const message = failedPendingInteractionMessage(failedInteraction);
    const failedPrompt = markPendingPromptFailed(pendingPrompt, message, Date.now());
    setPendingPrompt(failedPrompt);
    setPendingPromptStatus(message);
    setPendingPromptFailed(true);
    if (ownerUserId && workspace) {
      void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
    }
  }, [
    ownerUserId,
    pendingInteractions,
    pendingPrompt,
    pendingPromptFailed,
    setPendingPrompt,
    setPendingPromptFailed,
    setPendingPromptStatus,
    workspace?.id,
  ]);

  useEffect(() => {
    const command = promptCommand;
    if (!command || command.commandId !== pendingPromptCommandId) {
      return;
    }
    if (!isTerminalCommandStatus(command.status)) {
      return;
    }
    void transcriptRefetch();
    void sessionEventsRefetch();
  }, [
    promptCommand?.commandId,
    promptCommand?.status,
    pendingPromptCommandId,
    sessionEventsRefetch,
    transcriptRefetch,
  ]);

  useMobilePendingPromptDispatcher({
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
  });

  useEffect(() => {
    if (
      !pendingPrompt?.dispatchedSessionId
      || !pendingPromptDurable
      || !ownerUserId
      || !workspace
    ) {
      return;
    }
    setPendingPrompt(null);
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    void clearPendingMobilePrompt(workspace.id, ownerUserId);
    onInitialPendingPromptConsumed?.();
  }, [
    onInitialPendingPromptConsumed,
    ownerUserId,
    pendingPrompt?.dispatchedSessionId,
    pendingPromptDurable,
    setPendingPrompt,
    setPendingPromptFailed,
    setPendingPromptStatus,
    workspace?.id,
  ]);
}
