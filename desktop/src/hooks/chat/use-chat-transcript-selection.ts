import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
  isPrimarySelectAllEvent,
  resolveCopyAction,
  resolvePointerOwnership,
  resolvePrimaryAAction,
  resolveSelectionChangeAction,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "@/lib/domain/chat/transcript/transcript-selection";

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
      isSelectAll: isPrimarySelectAllEvent(event),
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
  const candidate = element.closest("input, textarea, select, [contenteditable]");
  if (!candidate) {
    return false;
  }
  if (candidate instanceof HTMLElement && candidate.isContentEditable) {
    return true;
  }
  return candidate.matches("input, textarea, select");
}

function isNativeInteractiveElement(element: Element): boolean {
  return !!element.closest("button, a[href], input, textarea, select, summary, [contenteditable]");
}

function isAriaInteractiveElement(element: Element): boolean {
  return !!element.closest([
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
  ].join(","));
}

function setCollapsedRootMarker(root: HTMLElement): void {
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStart(root, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isCollapsedRootMarkerSelection(
  selection: Selection,
  root: HTMLElement,
): boolean {
  if (selection.rangeCount !== 1) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return range.collapsed
    && range.startContainer === root
    && range.startOffset === 0
    && range.endContainer === root
    && range.endOffset === 0;
}

function isExactRootSelection(selection: Selection, root: HTMLElement): boolean {
  if (selection.rangeCount !== 1) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const rootRange = document.createRange();
  rootRange.selectNodeContents(root);
  return range.compareBoundaryPoints(Range.START_TO_START, rootRange) === 0
    && range.compareBoundaryPoints(Range.END_TO_END, rootRange) === 0;
}

function nodeInsideRoot(node: Node | null, root: HTMLElement): boolean {
  return !!node && root.contains(node);
}

function getSelectionDirection(selection: Selection): "forward" | "backward" {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) {
    return "forward";
  }
  if (anchor === focus) {
    return selection.focusOffset >= selection.anchorOffset ? "forward" : "backward";
  }
  const position = anchor.compareDocumentPosition(focus);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ? "forward"
    : "backward";
}

function clampSelectionToRoot(
  selection: Selection,
  root: HTMLElement,
  edge: TranscriptSelectionClampEdge,
): void {
  const edgePosition = edge === "start"
    ? findFirstTextPosition(root)
    : findLastTextPosition(root);
  if (!edgePosition) {
    return;
  }

  if (nodeInsideRoot(selection.anchorNode, root) && typeof selection.extend === "function") {
    selection.extend(edgePosition.node, edgePosition.offset);
    return;
  }

  if (nodeInsideRoot(selection.focusNode, root) && typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      edgePosition.node,
      edgePosition.offset,
      selection.focusNode!,
      selection.focusOffset,
    );
  }
}

function findLastTextPosition(
  el: HTMLElement,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    last = node;
  }
  if (last) {
    return { node: last, offset: last.textContent?.length ?? 0 };
  }
  return { node: el, offset: el.childNodes.length };
}

function findFirstTextPosition(
  el: HTMLElement,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) {
    return { node: first, offset: 0 };
  }
  return { node: el, offset: 0 };
}
