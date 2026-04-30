import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { isApplePlatform } from "@/lib/domain/shortcuts/matching";
import type { HeaderChatTabEntry } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";

export function useHeaderTabsMultiSelect({
  workspaceId,
  chatTabs,
  stripChatSessionIds,
}: {
  workspaceId: string | null;
  chatTabs: HeaderChatTabEntry[];
  stripChatSessionIds: string[];
}) {
  const [multiSelectedSessionIds, setMultiSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const suppressNextSelectClickSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMultiSelectedSessionIds(new Set());
    suppressNextSelectClickSessionIdRef.current = null;
  }, [workspaceId]);

  const selectedTopLevelSessionIds = useMemo(
    () => {
      const tabsById = new Map(chatTabs.map((tab) => [tab.id, tab]));
      return stripChatSessionIds.filter((sessionId) => {
        const tab = tabsById.get(sessionId);
        return !!tab
          && multiSelectedSessionIds.has(sessionId)
          && !tab.isChild;
      });
    },
    [chatTabs, multiSelectedSessionIds, stripChatSessionIds],
  );

  const clearSelection = useCallback(() => {
    setMultiSelectedSessionIds(new Set());
    suppressNextSelectClickSessionIdRef.current = null;
  }, []);

  const toggleSelection = useCallback((sessionId: string) => {
    setMultiSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const suppressNextSelectClick = useCallback((sessionId: string) => {
    suppressNextSelectClickSessionIdRef.current = sessionId;
  }, []);

  const consumeSuppressedSelectClick = useCallback((sessionId: string) => {
    if (suppressNextSelectClickSessionIdRef.current !== sessionId) {
      return false;
    }
    suppressNextSelectClickSessionIdRef.current = null;
    return true;
  }, []);

  return {
    multiSelectedSessionIds,
    selectedTopLevelSessionIds,
    clearSelection,
    toggleSelection,
    suppressNextSelectClick,
    consumeSuppressedSelectClick,
  };
}

export function isPrimaryMultiSelectClick(event: MouseEvent<HTMLButtonElement>): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

export function isPrimaryMultiSelectPointer(event: PointerEvent<HTMLButtonElement>): boolean {
  if (event.button !== 0 || event.altKey || event.shiftKey) {
    return false;
  }
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}
