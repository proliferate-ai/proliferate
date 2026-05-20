import { useEffect } from "react";
import {
  resolveRelativeRightPanelHeaderEntryKey,
  resolveRightPanelHeaderEntryKeyByShortcutIndex,
} from "@/lib/domain/workspaces/shell/right-panel-shortcuts";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelHeaderEntryKey } from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  RIGHT_PANEL_SHORTCUT_EVENT,
  rightPanelShortcutRequestFromEvent,
} from "@/lib/workflows/workspaces/right-panel-shortcut-requests";

export function useRightPanelShortcutRequests({
  activeEntryKey,
  entries,
  isOpen,
  onActivateEntry,
  onHandledRequest,
}: {
  activeEntryKey: RightPanelHeaderEntryKey;
  entries: readonly RightPanelHeaderEntry[];
  isOpen: boolean;
  onActivateEntry: (entryKey: RightPanelHeaderEntryKey) => boolean;
  onHandledRequest?: () => void;
}): void {
  useEffect(() => {
    const handleShortcutRequest = (event: Event) => {
      if (!isOpen) {
        return;
      }

      const request = rightPanelShortcutRequestFromEvent(event);
      if (!request) {
        return;
      }

      const nextEntryKey = request.kind === "relative-tab"
        ? resolveRelativeRightPanelHeaderEntryKey({
            entries,
            activeEntryKey,
            delta: request.delta,
          })
        : resolveRightPanelHeaderEntryKeyByShortcutIndex(entries, request.digit);
      if (!nextEntryKey) {
        return;
      }

      if (onActivateEntry(nextEntryKey)) {
        onHandledRequest?.();
        event.preventDefault();
      }
    };

    window.addEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handleShortcutRequest);
    return () => {
      window.removeEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handleShortcutRequest);
    };
  }, [
    activeEntryKey,
    entries,
    isOpen,
    onActivateEntry,
    onHandledRequest,
  ]);
}
