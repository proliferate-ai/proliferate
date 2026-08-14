import { useEffect, useState, type RefObject } from "react";
import type { SelectedResponseAnchorRect } from "#product/domain/chats/transcript/selected-response-context";
import { findAnnotationRanges } from "#product/hooks/chat/ui/selected-response-annotation-anchors";
import { isSelectedResponseInViewport } from "#product/hooks/chat/ui/selected-response-selection";
import { useChatSelectedResponseContexts } from "#product/hooks/chat/ui/use-chat-draft-state";
import { resolveChatDraftWorkspaceId } from "#product/lib/domain/chat/composer/chat-input";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

interface AnnotationMarker {
  id: string;
  ordinal: number;
  left: number;
  top: number;
}

/**
 * Numbered badges pinned over each annotated excerpt for as long as the
 * annotation stays attached to the composer. Anchors are re-located from the
 * excerpt TEXT on every scroll/layout/mutation pass, so markers survive
 * transcript re-renders and virtualization (they simply hide while their text
 * is not in the DOM or outside the scroller's visible bounds).
 */
export function ConnectedSelectedResponseAnnotationMarkers({
  rootRef,
}: {
  rootRef: RefObject<HTMLElement | null>;
}) {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const workspaceUiKey = resolveChatDraftWorkspaceId(
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  );
  const contexts = useChatSelectedResponseContexts(workspaceUiKey);
  const [markers, setMarkers] = useState<AnnotationMarker[]>([]);

  useEffect(() => {
    if (contexts.length === 0) {
      setMarkers([]);
      return;
    }
    let frameId = 0;
    const compute = () => {
      const root = rootRef.current;
      if (!root) {
        setMarkers([]);
        return;
      }
      const ranges = findAnnotationRanges(root, contexts.map((context) => context.text));
      const next: AnnotationMarker[] = [];
      ranges.forEach((range, index) => {
        if (!range) {
          return;
        }
        // First line-box rect when available (multi-line excerpts anchor at
        // their first line); jsdom's Range has neither rect API.
        const rect = range.getClientRects?.()[0]
          ?? range.getBoundingClientRect?.()
          ?? ZERO_RECT;
        if (!isSelectedResponseInViewport({ text: "", anchorRect: toAnchorRect(rect) }, root)) {
          return;
        }
        next.push({
          id: contexts[index]!.id,
          ordinal: index + 1,
          left: rect.left,
          top: rect.top,
        });
      });
      setMarkers((previous) => (markersEqual(previous, next) ? previous : next));
    };
    const schedule = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    if (rootRef.current) {
      observer.observe(rootRef.current, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [contexts, rootRef]);

  return (
    <>
      {markers.map((marker) => (
        <span
          key={marker.id}
          // Runtime-calculated position from the re-located excerpt rect —
          // the same sanctioned inline-style case as the selection menu's
          // anchor.
          style={{
            position: "fixed",
            top: marker.top,
            left: marker.left,
            transform: "translate(-50%, -70%)",
          }}
          className="pointer-events-none z-raised flex size-5 items-center justify-center rounded-full bg-special text-ui-sm tabular-nums text-special-foreground shadow-popover"
          data-annotation-marker={marker.ordinal}
        >
          {marker.ordinal}
        </span>
      ))}
    </>
  );
}

const ZERO_RECT: SelectedResponseAnchorRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
};

function toAnchorRect(rect: SelectedResponseAnchorRect): SelectedResponseAnchorRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function markersEqual(a: readonly AnnotationMarker[], b: readonly AnnotationMarker[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((marker, index) => {
    const other = b[index]!;
    return marker.id === other.id
      && marker.ordinal === other.ordinal
      && marker.left === other.left
      && marker.top === other.top;
  });
}
