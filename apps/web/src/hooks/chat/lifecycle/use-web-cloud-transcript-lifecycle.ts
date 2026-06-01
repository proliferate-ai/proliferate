import { useEffect, type Dispatch, type SetStateAction } from "react";
import type {
  CloudSessionProjection,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  cloudTranscriptHasAgentProgressAfterPrompt,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import {
  getLiveConfigControlValue,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { PendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import type { WebCloudPromptIntent } from "../../../stores/cloud/web-cloud-chat-state-store";

export function useWebCloudTranscriptLifecycle(input: {
  session: CloudSessionProjection | null;
  sessionLiveLastPatchAt: Date | number | null | undefined;
  transcriptRefetch: () => void;
  sessionEventsRefetch: () => void;
  pendingHomePrompt: PendingHomePrompt | null;
  directPromptDispatching: boolean;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  liveConfig: Parameters<typeof getLiveConfigControlValue>[0] | null;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
}) {
  const {
    session,
    sessionLiveLastPatchAt,
    transcriptRefetch,
    sessionEventsRefetch,
    pendingHomePrompt,
    directPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    transcriptItems,
    transcriptRows,
    liveConfig,
    setPendingConfigChanges,
  } = input;

  useEffect(() => {
    if (!session || !sessionLiveLastPatchAt) {
      return;
    }
    void transcriptRefetch();
    void sessionEventsRefetch();
  }, [
    session?.sessionId,
    sessionLiveLastPatchAt,
    sessionEventsRefetch,
    transcriptRefetch,
  ]);

  useEffect(() => {
    if (session && !pendingHomePrompt && !directPromptDispatching) {
      setPendingHomePromptStatus(null);
    }
  }, [directPromptDispatching, pendingHomePrompt, session?.sessionId, setPendingHomePromptStatus]);

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
  }, [session?.sessionId, setOptimisticPrompts, transcriptItems, transcriptRows]);

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
}
