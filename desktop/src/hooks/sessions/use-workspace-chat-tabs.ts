import { useStoreWithEqualityFn } from "zustand/traditional";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { getProviderDisplayName } from "@/config/providers";
import {
  resolveSessionViewState,
  type SessionViewState,
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";

export interface ChatTabEntry {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  isActive: boolean;
}

export function useWorkspaceChatTabs(
  selectedWorkspaceId: string | null,
  activeSessionId: string | null,
  isChatActive: boolean,
): ChatTabEntry[] {
  return useStoreWithEqualityFn(
    useHarnessStore,
    (state) =>
      Object.values(state.sessionSlots)
        .filter((slot) =>
          sessionSlotBelongsToWorkspace(slot, selectedWorkspaceId),
        )
        .map((slot) => ({
          id: slot.sessionId,
          title:
            getEffectiveSessionTitle(slot) ??
            getProviderDisplayName(slot.agentKind),
          agentKind: slot.agentKind,
          viewState: resolveSessionViewState(slot),
          isActive: isChatActive && slot.sessionId === activeSessionId,
        })),
    (a, b) =>
      a.length === b.length &&
      a.every(
        (tab, i) =>
          tab.id === b[i].id &&
          tab.title === b[i].title &&
          tab.agentKind === b[i].agentKind &&
          tab.viewState === b[i].viewState &&
          tab.isActive === b[i].isActive,
      ),
  );
}
