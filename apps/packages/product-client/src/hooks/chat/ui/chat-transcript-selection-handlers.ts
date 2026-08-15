import type { RefObject } from "react";
import {
  isPrimarySelectAllEvent,
  resolveCopyAction,
  resolvePointerOwnership,
  resolvePrimaryAAction,
  resolveSelectionChangeAction,
  type TranscriptPrimaryAAction,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "#product/domain/chats/transcript/transcript-selection";
import type {
  SelectedResponseSelection,
} from "#product/domain/chats/transcript/selected-response-context";
import { SELECT_ALL_COMMAND_EVENT } from "#product/lib/infra/dom/dom-select-all";

interface TranscriptSelectionListenerTargets {
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener">;
}

interface TranscriptSelectionListenerHandlers {
  pointerdown: (event: PointerEvent) => void;
  pointerup: () => void;
  keydown: (event: KeyboardEvent) => void;
  selectall: (event: Event) => void;
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
  isSelectAllCommandOwner: (
    target: EventTarget | null,
    root: HTMLElement | null,
  ) => boolean;
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
  isSelectedResponseMenuHovered: () => boolean;
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
  targets.windowTarget.addEventListener(SELECT_ALL_COMMAND_EVENT, handlers.selectall);
  targets.windowTarget.addEventListener("copy", handlers.copy, { capture: true });
  targets.windowTarget.addEventListener("scroll", handlers.scroll, { capture: true });
  targets.documentTarget.addEventListener("selectionchange", handlers.selectionchange);

  return () => {
    targets.windowTarget.removeEventListener("pointerdown", handlers.pointerdown, { capture: true });
    targets.windowTarget.removeEventListener("pointerup", handlers.pointerup, { capture: true });
    targets.windowTarget.removeEventListener("pointercancel", handlers.pointerup, { capture: true });
    targets.windowTarget.removeEventListener("keydown", handlers.keydown, { capture: true });
    targets.windowTarget.removeEventListener(SELECT_ALL_COMMAND_EVENT, handlers.selectall);
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
  isSelectAllCommandOwner,
  focusRoot,
  setFullSelectionMarker,
  isFullSelectionMarker,
  isExactRootSelection: isExactRootSelectionForRoot,
  nodeInsideRoot: nodeInsideRootForRoot,
  getSelectionDirection: getSelectionDirectionForSelection,
  clampSelectionToRoot: clampSelectionToRootForSelection,
  getSelectedResponse,
  isSelectedResponseVisible,
  isSelectedResponseMenuHovered,
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

  const applyPrimaryAAction = (
    action: TranscriptPrimaryAAction,
    event: Pick<Event, "preventDefault">,
  ) => {
    if (action === "ignore") {
      return;
    }
    if (action === "clear-owned") {
      clearSelectionState();
      return;
    }

    const root = rootRef.current;
    if (!root) {
      clearSelectionState();
      return;
    }

    event.preventDefault();
    focusRoot(root);
    setFullSelectionMarker(root);
    transcriptOwnedRef.current = true;
    allTranscriptSelectedRef.current = true;
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
    const activeElement = getActiveElement();
    const isSelectAll = isPrimarySelectAllEvent(event, isApplePlatform());
    const commandOwnerActive = isSelectAll
      && (
        isSelectAllCommandOwner(event.target, root)
        || isSelectAllCommandOwner(activeElement, root)
      );
    const action = resolvePrimaryAAction({
      owned: transcriptOwnedRef.current,
      commandOwnerActive,
      isSelectAll,
      defaultPrevented: event.defaultPrevented,
      eventTarget: getTargetFactsForEvent(event.target, root),
      activeTarget: getTargetFactsForEvent(activeElement, root),
    });
    applyPrimaryAAction(action, event);
  };

  const selectall = (event: Event) => {
    const root = rootRef.current;
    const activeElement = getActiveElement();
    const activeTarget = getTargetFactsForEvent(activeElement, root);
    const commandOwnerActive = isSelectAllCommandOwner(activeElement, root);
    const action = resolvePrimaryAAction({
      // Native macOS menu accelerators do not emit a WebView keydown. The
      // active chat surface is therefore a separate command-ownership signal
      // from an existing native text selection.
      owned: transcriptOwnedRef.current,
      commandOwnerActive,
      isSelectAll: true,
      defaultPrevented: event.defaultPrevented,
      eventTarget: getTargetFactsForEvent(event.target, root),
      activeTarget,
    });
    applyPrimaryAAction(action, event);
  };

  const selectionchange = () => {
    const root = rootRef.current;
    // WebKit clears the window selection while the user is USING the menu:
    // keyboard invocation focuses the first item (focus moves collapse the
    // selection), and pressing an item clears it natively on mouse-down even
    // though the item cancels the pointerdown — the unmount then wins the
    // race against pointerup, so the click never activates anything. Either
    // loss is a side effect of operating the menu, not the user abandoning
    // it, so the published selection survives while the menu owns focus or
    // sits under the pointer.
    if (
      hasSelectedResponse()
      && (
        getTargetFactsForEvent(getActiveElement(), root).contextualActions
        || isSelectedResponseMenuHovered()
      )
    ) {
      return;
    }
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
    selectall,
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
