import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  clampSelectionToRoot,
  getSelectionDirection,
  getTargetFacts,
  isCollapsedRootMarkerSelection,
  isExactRootSelection,
  nodeInsideRoot,
  setCollapsedRootMarker,
} from "./chat-transcript-selection-dom";
import { createChatTranscriptSelectionHandlers } from "./chat-transcript-selection-handlers";
import { attachChatTranscriptSelectionListeners } from "./chat-transcript-selection-listeners";

interface UseChatTranscriptSelectionArgs {
  rootRef: RefObject<HTMLElement | null>;
  getCopyText: () => string;
}

export function useChatTranscriptSelection({
  rootRef,
  getCopyText,
}: UseChatTranscriptSelectionArgs): void {
  // Chat-specific selection ownership for semantic transcript copy behavior.
  const getCopyTextRef = useRef(getCopyText);
  const transcriptOwnedRef = useRef(false);
  const allTranscriptSelectedRef = useRef(false);

  useLayoutEffect(() => {
    getCopyTextRef.current = getCopyText;
  }, [getCopyText]);

  useEffect(() => {
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef,
      getCopyText: () => getCopyTextRef.current(),
      transcriptOwnedRef,
      allTranscriptSelectedRef,
      getActiveElement: () => document.activeElement,
      getSelection: () => document.getSelection(),
      getTargetFactsForEvent: getTargetFacts,
      focusRoot: (root) => root.focus({ preventScroll: true }),
      setFullSelectionMarker: setCollapsedRootMarker,
      isFullSelectionMarker: isCollapsedRootMarkerSelection,
      isExactRootSelection,
      nodeInsideRoot,
      getSelectionDirection,
      clampSelectionToRoot,
    });

    const detach = attachChatTranscriptSelectionListeners({
      windowTarget: window,
      documentTarget: document,
    }, handlers);

    return () => {
      transcriptOwnedRef.current = false;
      allTranscriptSelectedRef.current = false;
      detach();
    };
  }, [rootRef]);
}
