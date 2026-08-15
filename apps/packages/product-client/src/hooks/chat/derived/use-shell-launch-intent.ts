import { useMemo } from "react";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import {
  resolveLaunchIntentForShell,
} from "#product/lib/domain/chat/launch/launch-intent-registry";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

/**
 * The launch intent this shell shows, out of every intent in flight. With
 * several launches running at once "the" active intent is no longer a
 * question a surface can ask — it has to ask for its own (PRO-230).
 */
export function useShellLaunchIntent(): ChatLaunchIntent | null {
  const intentsById = useChatLaunchIntentStore((state) => state.intentsById);
  const intentOrder = useChatLaunchIntentStore((state) => state.intentOrder);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  return useMemo(
    () => resolveLaunchIntentForShell({ intentsById, intentOrder }, {
      shellLogicalWorkspaceId: selectedLogicalWorkspaceId,
      shellWorkspaceId: selectedWorkspaceId,
    }),
    [intentOrder, intentsById, selectedLogicalWorkspaceId, selectedWorkspaceId],
  );
}
