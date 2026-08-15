import { useEffect, useState, type RefObject } from "react";
import { X } from "#product/primitives/icons/core";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import type { SelectedResponseAnchorRect } from "#product/domain/chats/transcript/selected-response-context";
import { findAnnotationRanges } from "#product/hooks/chat/ui/selected-response-annotation-anchors";
import { isSelectedResponseInViewport } from "#product/hooks/chat/ui/selected-response-selection";
import { useChatSelectedResponseContexts } from "#product/hooks/chat/ui/use-chat-draft-state";
import { resolveChatDraftWorkspaceId } from "#product/lib/domain/chat/composer/chat-input";
import { Button } from "#product/primitives/Button";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

interface AnnotationMarker {
  id: string;
  ordinal: number;
  comment: string | null;
  left: number;
  top: number;
}

const ANNOTATION_HIGHLIGHT_NAME = "annotation";

/**
 * Numbered badges pinned astride the top-left corner of each annotated
 * excerpt for as long as the annotation stays attached to the composer, with
 * the excerpt itself painted through the custom-highlight registry
 * (`::highlight(annotation)` in the shared product stylesheet).
 * Hovering a badge previews the annotation's comment and offers a × that
 * removes just that annotation (the rest renumber; the composer pill count
 * follows). Anchors are re-located from the excerpt TEXT on every
 * scroll/layout/mutation pass, so markers survive transcript re-renders and
 * virtualization (they simply hide while their text is not in the DOM or
 * outside the scroller's visible bounds).
 */
export function ConnectedSelectedResponseAnnotationMarkers({
  rootRef,
  suppressedAnnotationId = null,
}: {
  rootRef: RefObject<HTMLElement | null>;
  /** Badge hidden while this annotation's comment editor is open above it. */
  suppressedAnnotationId?: string | null;
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
  const removeSelectedResponseContext = useChatInputStore(
    (state) => state.removeSelectedResponseContext,
  );
  const [markers, setMarkers] = useState<AnnotationMarker[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (contexts.length === 0) {
      setMarkers([]);
      clearAnnotationHighlight();
      return;
    }
    let frameId = 0;
    const compute = () => {
      const root = rootRef.current;
      if (!root) {
        setMarkers([]);
        clearAnnotationHighlight();
        return;
      }
      const ranges = findAnnotationRanges(root, contexts.map((context) => context.text));
      // Every re-located excerpt is painted, even offscreen ones — the wash
      // scrolls with the text; only the BADGES hide outside the viewport.
      setAnnotationHighlight(ranges.filter((range): range is Range => range !== null));
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
          comment: contexts[index]!.comment ?? null,
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
      clearAnnotationHighlight();
    };
  }, [contexts, rootRef]);

  return (
    <>
      {markers.map((marker) => marker.id === suppressedAnnotationId ? null : (
        <span
          key={marker.id}
          // Runtime-calculated position from the re-located excerpt rect —
          // the same sanctioned inline-style case as the selection menu's
          // anchor. The translate parks the badge astride the highlight's
          // top-left corner.
          style={{
            position: "fixed",
            top: marker.top,
            left: marker.left,
            transform: "translate(-45%, -80%)",
          }}
          className="z-raised flex size-5 items-center justify-center rounded-full bg-special text-ui-sm tabular-nums text-special-foreground shadow-popover"
          data-annotation-marker={marker.ordinal}
          onMouseEnter={() => setHoveredId(marker.id)}
          onMouseLeave={() => setHoveredId((current) => (current === marker.id ? null : current))}
        >
          {marker.ordinal}
          {hoveredId === marker.id ? (
            <>
              <span
                className="absolute bottom-full left-0 mb-1.5 w-max max-w-64 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-ui-sm shadow-popover"
                data-annotation-comment-preview
                data-telemetry-mask
              >
                {marker.comment ? (
                  <span className="text-foreground">{marker.comment}</span>
                ) : (
                  <span className="italic text-muted-foreground">
                    {CHAT_SELECTED_RESPONSE_ACTIONS.annotationNoComment}
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="unstyled"
                className="absolute -top-1.5 left-3 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background"
                aria-label={CHAT_SELECTED_RESPONSE_ACTIONS.annotationRemoveLabel}
                title={CHAT_SELECTED_RESPONSE_ACTIONS.annotationRemoveLabel}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (workspaceUiKey) {
                    removeSelectedResponseContext(workspaceUiKey, marker.id);
                  }
                  setHoveredId(null);
                }}
              >
                <X aria-hidden="true" className="icon-compact" />
              </Button>
            </>
          ) : null}
        </span>
      ))}
    </>
  );
}

function setAnnotationHighlight(ranges: readonly Range[]): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
    return;
  }
  if (ranges.length === 0) {
    CSS.highlights.delete(ANNOTATION_HIGHLIGHT_NAME);
    return;
  }
  CSS.highlights.set(ANNOTATION_HIGHLIGHT_NAME, new Highlight(...ranges));
}

function clearAnnotationHighlight(): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) {
    return;
  }
  CSS.highlights.delete(ANNOTATION_HIGHLIGHT_NAME);
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
      && marker.comment === other.comment
      && marker.left === other.left
      && marker.top === other.top;
  });
}
