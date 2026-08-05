import {
  useEffect,
  useLayoutEffect,
  useRef,
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
} from "@proliferate/product-domain/chats/transcript/transcript-selection";

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
  keydown: (event: KeyboardEvent) => void;
  copy: (event: ClipboardEvent) => void;
  selectionchange: () => void;
}

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

export function attachChatTranscriptSelectionListeners(
  targets: TranscriptSelectionListenerTargets,
  handlers: TranscriptSelectionListenerHandlers,
): () => void {
  targets.windowTarget.addEventListener("pointerdown", handlers.pointerdown, { capture: true });
  targets.windowTarget.addEventListener("keydown", handlers.keydown, { capture: true });
  targets.windowTarget.addEventListener("copy", handlers.copy, { capture: true });
  targets.documentTarget.addEventListener("selectionchange", handlers.selectionchange);

  return () => {
    targets.windowTarget.removeEventListener("pointerdown", handlers.pointerdown, { capture: true });
    targets.windowTarget.removeEventListener("keydown", handlers.keydown, { capture: true });
    targets.windowTarget.removeEventListener("copy", handlers.copy, { capture: true });
    targets.documentTarget.removeEventListener("selectionchange", handlers.selectionchange);
  };
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

export function useChatTranscriptSelection({
  rootRef,
  getCopyText,
}: UseChatTranscriptSelectionArgs): void {
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
