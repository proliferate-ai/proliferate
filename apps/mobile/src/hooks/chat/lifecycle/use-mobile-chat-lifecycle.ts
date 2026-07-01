import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
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
  failedPendingInteractionForPendingPrompt,
  failedPendingInteractionMessage,
  markPendingPromptFailed,
  type OptimisticPrompt,
} from "../../../lib/domain/chat/mobile-chat-transcript";
import { useMobilePendingPromptDispatcher } from "./use-mobile-pending-prompt-dispatcher";
import { useMobilePendingPromptRestore } from "./use-mobile-pending-prompt-restore";

export function useMobileChatLifecycle({
  chat,
  ownerUserId,
  onInitialPendingPromptConsumed,
  onSessionSelected,
  client,
  productToken,
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
  pendingConfigChanges,
  pendingDispatchRunRef,
  setDraft,
  setSelectedSessionId,
  setNewSessionMode,
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
  productToken: string | null;
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
  pendingConfigChanges: Record<string, PendingConfigChange>;
  pendingDispatchRunRef: MutableRefObject<{ key: string; active: boolean } | null>;
  setDraft: Dispatch<SetStateAction<string>>; setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setNewSessionMode: Dispatch<SetStateAction<boolean>>; setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
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

  useMobilePendingPromptDispatcher({
    client,
    productToken,
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
