import { useEffect, useRef } from "react";

interface UseMessageListScrollArgs {
  bottomInsetPx: number;
  totalItems: number;
  pendingPromptText: string | null;
  isSessionBusy: boolean;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
}

export function useMessageListScroll({
  bottomInsetPx,
  totalItems,
  pendingPromptText,
  isSessionBusy,
  selectedWorkspaceId,
  activeSessionId,
}: UseMessageListScrollArgs) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 96;
    };

    updateStickiness();
    el.addEventListener("scroll", updateStickiness, { passive: true });
    return () => {
      el.removeEventListener("scroll", updateStickiness);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const scrollToBottomIfSticky = () => {
      if (!shouldStickToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    };

    scrollToBottomIfSticky();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      scrollToBottomIfSticky();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [bottomInsetPx, isSessionBusy, pendingPromptText, totalItems]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeSessionId, selectedWorkspaceId]);

  return {
    scrollRef,
    contentRef,
  };
}
