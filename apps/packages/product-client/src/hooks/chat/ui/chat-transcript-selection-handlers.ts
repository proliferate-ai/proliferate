import type { RefObject } from "react";
import {
  isPrimarySelectAllEvent,
  resolveCopyAction,
  resolvePointerOwnership,
  resolvePrimaryAAction,
  resolveSelectionChangeAction,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "#product/domain/chats/transcript/transcript-selection";
import type {
  SelectedResponseSelection,
} from "#product/domain/chats/transcript/selected-response-context";

interface TranscriptSelectionListenerTargets {
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener">;
}

interface TranscriptSelectionListenerHandlers {
  pointerdown: (event: PointerEvent) => void;
  pointerup: () => void;
  keydown: (event: KeyboardEvent) => void;
  copy: (event: ClipboardEvent) => void;
  selectionchange: () => void;
  scroll: () => void;
}

interface MutableBooleanRef {
  current: boolean;
}

interface ChatTranscriptSelectionHandlerArgs {
  rootRef: RefObject<HTMLElement | null>;
  getCopyText: () => string;
  transcriptOwnedRef: MutableBooleanRef;
  allTranscriptSelectedRef: MutableBooleanRef;
  pointerSelectingRef: MutableBooleanRef;
  getActiveElement: () => EventTarget | null;
  getSelection: () => Selection | null;
  getTargetFactsForEvent: (
    target: EventTarget | null,
    root: HTMLElement | null,
  ) => TranscriptTargetFacts;
  focusRoot: (root: HTMLElement) => void;
  setFullSelectionMarker: (root: HTMLElement) => void;
  isFullSelectionMarker: (selection: Selection, root: HTMLElement) => boolean;
  isExactRootSelection: (selection: Selection, root: HTMLElement) => boolean;
  nodeInsideRoot: (node: Node | null, root: HTMLElement) => boolean;
  getSelectionDirection: (selection: Selection) => "forward" | "backward";
  clampSelectionToRoot: (
    selection: Selection,
    root: HTMLElement,
    edge: TranscriptSelectionClampEdge,
  ) => void;
  getSelectedResponse: (
    selection: Selection,
    root: HTMLElement,
  ) => SelectedResponseSelection | null;
  isSelectedResponseVisible: (
    selection: SelectedResponseSelection,
    root: HTMLElement,
  ) => boolean;
  setSelectedResponse: (selection: SelectedResponseSelection | null) => void;
  hasSelectedResponse: () => boolean;
  requestSelectedResponseMenuFocus: () => void;
  dismissSelectedResponse: (restoreTranscriptFocus: boolean) => void;
}

export function attachChatTranscriptSelectionListeners(
  targets: TranscriptSelectionListenerTargets,
  handlers: TranscriptSelectionListenerHandlers,
): () => void {
  targets.windowTarget.addEventListener("pointerdown", handlers.pointerdown, { capture: true });
  targets.windowTarget.addEventListener("pointerup", handlers.pointerup, { capture: true });
  targets.windowTarget.addEventListener("pointercancel", handlers.pointerup, { capture: true });
  targets.windowTarget.addEventListener("keydown", handlers.keydown, { capture: true });
  targets.windowTarget.addEventListener("copy", handlers.copy, { capture: true });
  targets.windowTarget.addEventListener("scroll", handlers.scroll, { capture: true });
  targets.documentTarget.addEventListener("selectionchange", handlers.selectionchange);

  return () => {
    targets.windowTarget.removeEventListener("pointerdown", handlers.pointerdown, { capture: true });
    targets.windowTarget.removeEventListener("pointerup", handlers.pointerup, { capture: true });
    targets.windowTarget.removeEventListener("pointercancel", handlers.pointerup, { capture: true });
    targets.windowTarget.removeEventListener("keydown", handlers.keydown, { capture: true });
    targets.windowTarget.removeEventListener("copy", handlers.copy, { capture: true });
    targets.windowTarget.removeEventListener("scroll", handlers.scroll, { capture: true });
    targets.documentTarget.removeEventListener("selectionchange", handlers.selectionchange);
  };
}

export function createChatTranscriptSelectionHandlers({
  rootRef,
  getCopyText,
  transcriptOwnedRef,
  allTranscriptSelectedRef,
  pointerSelectingRef,
  getActiveElement,
  getSelection,
  getTargetFactsForEvent,
  focusRoot,
  setFullSelectionMarker,
  isFullSelectionMarker,
  isExactRootSelection: isExactRootSelectionForRoot,
  nodeInsideRoot: nodeInsideRootForRoot,
  getSelectionDirection: getSelectionDirectionForSelection,
  clampSelectionToRoot: clampSelectionToRootForSelection,
  getSelectedResponse,
  isSelectedResponseVisible,
  setSelectedResponse,
  hasSelectedResponse,
  requestSelectedResponseMenuFocus,
  dismissSelectedResponse,
}: ChatTranscriptSelectionHandlerArgs): TranscriptSelectionListenerHandlers {
  const clearSelectionState = () => {
    transcriptOwnedRef.current = false;
    allTranscriptSelectedRef.current = false;
  };

  const pointerdown = (event: PointerEvent) => {
    const root = rootRef.current;
    const targetFacts = getTargetFactsForEvent(event.target, root);
    const action = resolvePointerOwnership(targetFacts);
    if (action === "ignore") {
      return;
    }
    if (action === "track-selection") {
      pointerSelectingRef.current = true;
      setSelectedResponse(null);
      clearSelectionState();
      return;
    }
    if (action === "set-owned" && root) {
      pointerSelectingRef.current = true;
      transcriptOwnedRef.current = true;
      allTranscriptSelectedRef.current = false;
      setSelectedResponse(null);
      focusRoot(root);
      return;
    }
    pointerSelectingRef.current = false;
    setSelectedResponse(null);
    clearSelectionState();
  };

  const publishSelectedResponse = () => {
    const root = rootRef.current;
    const selection = getSelection();
    setSelectedResponse(
      root && selection
        ? getSelectedResponse(selection, root)
        : null,
    );
  };

  const pointerup = () => {
    if (!pointerSelectingRef.current) {
      return;
    }
    pointerSelectingRef.current = false;
    publishSelectedResponse();
  };

  const keydown = (event: KeyboardEvent) => {
    if (hasSelectedResponse() && event.key === "Escape") {
      event.preventDefault();
      dismissSelectedResponse(true);
      return;
    }
    if (
      hasSelectedResponse()
      && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
    ) {
      event.preventDefault();
      requestSelectedResponseMenuFocus();
      return;
    }
    const root = rootRef.current;
    const action = resolvePrimaryAAction({
      owned: transcriptOwnedRef.current,
      isSelectAll: isPrimarySelectAllEvent(event, isApplePlatform()),
      defaultPrevented: event.defaultPrevented,
      eventTarget: getTargetFactsForEvent(event.target, root),
      activeTarget: getTargetFactsForEvent(getActiveElement(), root),
    });

    if (action === "ignore") {
      return;
    }
    if (action === "clear-owned") {
      clearSelectionState();
      return;
    }
    if (!root) {
      clearSelectionState();
      return;
    }

    event.preventDefault();
    setFullSelectionMarker(root);
    transcriptOwnedRef.current = true;
    allTranscriptSelectedRef.current = true;
  };

  const selectionchange = () => {
    const root = rootRef.current;
    const selection = getSelection();
    if (!root || !selection || selection.rangeCount === 0) {
      allTranscriptSelectedRef.current = false;
      setSelectedResponse(null);
      return;
    }

    if (
      allTranscriptSelectedRef.current
      && isFullSelectionMarker(selection, root)
    ) {
      setSelectedResponse(null);
      return;
    }

    const exactRootSelection = isExactRootSelectionForRoot(selection, root);
    const action = resolveSelectionChangeAction({
      owned: transcriptOwnedRef.current,
      anchorInsideRoot: nodeInsideRootForRoot(selection.anchorNode, root),
      focusInsideRoot: nodeInsideRootForRoot(selection.focusNode, root),
      exactRootSelection,
      direction: getSelectionDirectionForSelection(selection),
    });

    if (action.clearFullSelection) {
      allTranscriptSelectedRef.current = false;
    }
    if (action.clampEdge) {
      clampSelectionToRootForSelection(selection, root, action.clampEdge);
    }
    if (!pointerSelectingRef.current) {
      publishSelectedResponse();
    }
  };

  const scroll = () => {
    if (!hasSelectedResponse()) {
      return;
    }
    const root = rootRef.current;
    const selection = getSelection();
    const selectedResponse = root && selection
      ? getSelectedResponse(selection, root)
      : null;
    setSelectedResponse(
      selectedResponse && root && isSelectedResponseVisible(selectedResponse, root)
        ? selectedResponse
        : null,
    );
  };

  const copy = (event: ClipboardEvent) => {
    const root = rootRef.current;
    const selection = getSelection();
    const action = resolveCopyAction({
      fullRootSelected: !!root
        && !!selection
        && allTranscriptSelectedRef.current
        && isFullSelectionMarker(selection, root),
      eventTarget: getTargetFactsForEvent(event.target, root),
      activeTarget: getTargetFactsForEvent(getActiveElement(), root),
    });

    if (action === "ignore") {
      return;
    }
    if (action === "clear-owned") {
      clearSelectionState();
      return;
    }
    if (!event.clipboardData) {
      return;
    }

    event.clipboardData.setData("text/plain", getCopyText());
    event.preventDefault();
  };

  return {
    pointerdown,
    pointerup,
    keydown,
    copy,
    selectionchange,
    scroll,
  };
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac|iphone|ipad|ipod/iu.test(navigator.platform);
}
