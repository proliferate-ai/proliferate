import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
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
import {
  getSelectedAssistantResponse,
  isSelectedResponseInViewport,
} from "#product/hooks/chat/ui/selected-response-selection";

interface UseChatTranscriptSelectionArgs {
  rootRef: RefObject<HTMLElement | null>;
  getCopyText: () => string;
}

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

export interface ChatTranscriptSelectionState {
  selectedResponse: SelectedResponseSelection | null;
  menuFocusRequestNonce: number;
  dismissSelectedResponse: (options?: {
    clearNativeSelection?: boolean;
    restoreTranscriptFocus?: boolean;
  }) => void;
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

export function useChatTranscriptSelection({
  rootRef,
  getCopyText,
}: UseChatTranscriptSelectionArgs): ChatTranscriptSelectionState {
  const getCopyTextRef = useRef(getCopyText);
  const transcriptOwnedRef = useRef(false);
  const allTranscriptSelectedRef = useRef(false);
  const pointerSelectingRef = useRef(false);
  const [selectedResponse, setSelectedResponse] = useState<SelectedResponseSelection | null>(null);
  const selectedResponseRef = useRef<SelectedResponseSelection | null>(null);
  const [menuFocusRequestNonce, setMenuFocusRequestNonce] = useState(0);

  const commitSelectedResponse = useCallback((selection: SelectedResponseSelection | null) => {
    selectedResponseRef.current = selection;
    setSelectedResponse(selection);
    if (!selection) {
      setMenuFocusRequestNonce(0);
    }
  }, []);

  const dismissSelectedResponse = useCallback((options?: {
    clearNativeSelection?: boolean;
    restoreTranscriptFocus?: boolean;
  }) => {
    commitSelectedResponse(null);
    if (options?.clearNativeSelection) {
      document.getSelection()?.removeAllRanges();
    }
    if (options?.restoreTranscriptFocus) {
      window.requestAnimationFrame(() => {
        rootRef.current?.focus({ preventScroll: true });
      });
    }
  }, [commitSelectedResponse, rootRef]);

  useLayoutEffect(() => {
    getCopyTextRef.current = getCopyText;
  }, [getCopyText]);

  useEffect(() => {
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef,
      getCopyText: () => getCopyTextRef.current(),
      transcriptOwnedRef,
      allTranscriptSelectedRef,
      pointerSelectingRef,
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
      getSelectedResponse: getSelectedAssistantResponse,
      isSelectedResponseVisible: isSelectedResponseInViewport,
      setSelectedResponse: commitSelectedResponse,
      hasSelectedResponse: () => selectedResponseRef.current !== null,
      requestSelectedResponseMenuFocus: () => {
        setMenuFocusRequestNonce((nonce) => nonce + 1);
      },
      dismissSelectedResponse: (restoreTranscriptFocus) => {
        dismissSelectedResponse({ restoreTranscriptFocus });
      },
    });

    const detach = attachChatTranscriptSelectionListeners({
      windowTarget: window,
      documentTarget: document,
    }, handlers);

    return () => {
      transcriptOwnedRef.current = false;
      allTranscriptSelectedRef.current = false;
      pointerSelectingRef.current = false;
      detach();
    };
  }, [commitSelectedResponse, dismissSelectedResponse, rootRef]);

  return {
    selectedResponse,
    menuFocusRequestNonce,
    dismissSelectedResponse,
  };
}

function getTargetFacts(
  target: EventTarget | null,
  root: HTMLElement | null,
): TranscriptTargetFacts {
  const element = targetToElement(target);
  if (!element || !root) {
    return EMPTY_TRANSCRIPT_TARGET_FACTS;
  }

  return {
    insideRoot: root.contains(element),
    contextualActions: !!element.closest("[data-selected-response-actions]"),
    selectableInteractiveText: !!element.closest('a, [role="link"]'),
    textEntry: isTextEntryElement(element),
    terminalZone: !!element.closest('[data-focus-zone="terminal"]'),
    ignoredChrome: !!element.closest("[data-chat-transcript-ignore]"),
    nativeInteractive: isNativeInteractiveElement(element),
    ariaInteractive: isAriaInteractiveElement(element),
  };
}

function targetToElement(target: EventTarget | null): Element | null {
  if (!target) {
    return null;
  }
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function isTextEntryElement(element: Element): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  return element.getAttribute("role") === "textbox";
}

function isNativeInteractiveElement(element: Element): boolean {
  return element instanceof HTMLButtonElement
    || element instanceof HTMLAnchorElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement;
}

function isAriaInteractiveElement(element: Element): boolean {
  const role = element.getAttribute("role");
  return role === "button"
    || role === "link"
    || role === "menuitem"
    || role === "option"
    || role === "tab";
}

function setCollapsedRootMarker(root: HTMLElement): void {
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.addRange(range);
}

function isCollapsedRootMarkerSelection(
  selection: Selection,
  root: HTMLElement,
): boolean {
  if (selection.rangeCount !== 1 || !selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return range.startContainer === root && range.endContainer === root;
}

function isExactRootSelection(
  selection: Selection,
  root: HTMLElement,
): boolean {
  if (selection.rangeCount !== 1) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return range.startContainer === root
    && range.endContainer === root
    && range.startOffset === 0
    && range.endOffset === root.childNodes.length;
}

function nodeInsideRoot(node: Node | null, root: HTMLElement): boolean {
  return !!node && (node === root || root.contains(node));
}

function getSelectionDirection(selection: Selection): "forward" | "backward" {
  if (!selection.anchorNode || !selection.focusNode || selection.rangeCount === 0) {
    return "forward";
  }
  const position = selection.anchorNode.compareDocumentPosition(selection.focusNode);
  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return "backward";
  }
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return "forward";
  }
  return selection.anchorOffset <= selection.focusOffset ? "forward" : "backward";
}

function clampSelectionToRoot(
  selection: Selection,
  root: HTMLElement,
  edge: TranscriptSelectionClampEdge,
): void {
  if (selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (edge === "start") {
    range.setStart(root, 0);
  } else {
    range.setEnd(root, root.childNodes.length);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac|iphone|ipad|ipod/iu.test(navigator.platform);
}
