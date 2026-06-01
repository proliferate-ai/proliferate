import { useEffect, type Dispatch, type SetStateAction } from "react";

import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../../navigation/navigation-model";
import {
  loadPendingMobilePrompt,
  savePendingMobilePrompt,
} from "../../../lib/access/cloud/pending-mobile-prompt-store";
import {
  rearmRetryablePendingMobilePrompt,
} from "../../../lib/access/cloud/pending-mobile-prompt-dispatch";

export function useMobilePendingPromptRestore({
  chat,
  ownerUserId,
  onInitialPendingPromptConsumed,
  onSessionSelected,
  setPendingPrompt,
  setPendingPromptFailed,
  setPendingPromptStatus,
  setSelectedSessionId,
  setNewSessionMode,
}: {
  chat: MobileCloudChat;
  ownerUserId: string | null;
  onInitialPendingPromptConsumed?: () => void;
  onSessionSelected?: (sessionId: string) => void;
  setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
  setPendingPromptFailed: Dispatch<SetStateAction<boolean>>;
  setPendingPromptStatus: Dispatch<SetStateAction<string | null>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setNewSessionMode: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!ownerUserId) {
      setPendingPrompt(null);
      setPendingPromptFailed(false);
      return;
    }
    let active = true;
    void loadPendingMobilePrompt(chat.workspaceId, ownerUserId).then((stored) => {
      const initialPrompt = chat.initialPendingPrompt ?? null;
      const restoredRaw = stored ?? initialPrompt;
      const restored = restoredRaw ? rearmRetryablePendingMobilePrompt(restoredRaw) : null;
      if (active) {
        setPendingPrompt(restored);
        setPendingPromptFailed(Boolean(restored?.failedAt));
        setPendingPromptStatus(
          restoredRaw && restoredRaw !== restored
            ? "Retrying queued prompt handoff."
            : restored?.failureMessage ?? null,
        );
        if (restored?.dispatchedSessionId) {
          setSelectedSessionId(restored.dispatchedSessionId);
          setNewSessionMode(false);
          onSessionSelected?.(restored.dispatchedSessionId);
        } else if (restored) {
          setSelectedSessionId(null);
          setNewSessionMode(true);
        }
        if (restoredRaw && restored && restoredRaw !== restored && ownerUserId) {
          void savePendingMobilePrompt(chat.workspaceId, ownerUserId, restored);
        }
        if (initialPrompt) {
          if (stored) {
            onInitialPendingPromptConsumed?.();
          } else if (restored) {
            void savePendingMobilePrompt(chat.workspaceId, ownerUserId, restored)
              .then(() => {
                if (active) {
                  onInitialPendingPromptConsumed?.();
                }
              })
              .catch(() => undefined);
          }
        }
      }
    });
    return () => {
      active = false;
    };
  }, [
    chat.initialPendingPrompt,
    chat.workspaceId,
    onInitialPendingPromptConsumed,
    onSessionSelected,
    ownerUserId,
  ]);
}
