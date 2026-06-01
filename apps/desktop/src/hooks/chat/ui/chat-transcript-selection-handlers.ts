import type { RefObject } from "react";
import {
  isPrimarySelectAllEvent,
  resolveCopyAction,
  resolvePointerOwnership,
  resolvePrimaryAAction,
  resolveSelectionChangeAction,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "@proliferate/product-domain/chats/transcript/transcript-selection";
import { isApplePlatform } from "@/lib/domain/shortcuts/matching";
import type { TranscriptSelectionListenerHandlers } from "./chat-transcript-selection-listeners";

interface MutableBooleanRef {
  current: boolean;
}

interface ChatTranscriptSelectionHandlerArgs {
  rootRef: RefObject<HTMLElement | null>;
  getCopyText: () => string;
  transcriptOwnedRef: MutableBooleanRef;
  allTranscriptSelectedRef: MutableBooleanRef;
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
}

export function createChatTranscriptSelectionHandlers({
  rootRef,
  getCopyText,
  transcriptOwnedRef,
  allTranscriptSelectedRef,
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
}: ChatTranscriptSelectionHandlerArgs): TranscriptSelectionListenerHandlers {
  const clearSelectionState = () => {
    transcriptOwnedRef.current = false;
    allTranscriptSelectedRef.current = false;
  };

  const pointerdown = (event: PointerEvent) => {
    const root = rootRef.current;
    const targetFacts = getTargetFactsForEvent(event.target, root);
    const action = resolvePointerOwnership(targetFacts);
    if (action === "set-owned" && root) {
      transcriptOwnedRef.current = true;
      allTranscriptSelectedRef.current = false;
      focusRoot(root);
      return;
    }
    clearSelectionState();
  };

  const keydown = (event: KeyboardEvent) => {
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
      return;
    }

    if (
      allTranscriptSelectedRef.current
      && isFullSelectionMarker(selection, root)
    ) {
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
    keydown,
    copy,
    selectionchange,
  };
}
