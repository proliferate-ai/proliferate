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
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "#product/domain/chats/transcript/transcript-selection";
import type {
  SelectedResponseSelection,
} from "#product/domain/chats/transcript/selected-response-context";
import {
  attachChatTranscriptSelectionListeners,
  createChatTranscriptSelectionHandlers,
} from "#product/hooks/chat/ui/chat-transcript-selection-handlers";
import {
  getSelectedAssistantResponse,
  isSelectedResponseInViewport,
} from "#product/hooks/chat/ui/selected-response-selection";
import { selectElementContents } from "#product/lib/infra/dom/dom-select-all";

interface UseChatTranscriptSelectionArgs {
  rootRef: RefObject<HTMLElement | null>;
  getCopyText: () => string;
}

export interface ChatTranscriptSelectionState {
  selectedResponse: SelectedResponseSelection | null;
  menuFocusRequestNonce: number;
  dismissSelectedResponse: (options?: {
    clearNativeSelection?: boolean;
    restoreTranscriptFocus?: boolean;
  }) => void;
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
      isSelectAllCommandOwner,
      focusRoot: (root) => root.focus({ preventScroll: true }),
      setFullSelectionMarker: (root) => {
        selectElementContents(root);
      },
      isFullSelectionMarker: isExactRootSelection,
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
    browserZone: !!element.closest('[data-focus-zone="browser"]'),
    ignoredChrome: !!element.closest("[data-chat-transcript-ignore]"),
    nativeInteractive: isNativeInteractiveElement(element),
    ariaInteractive: isAriaInteractiveElement(element),
  };
}

function isSelectAllCommandOwner(
  target: EventTarget | null,
  root: HTMLElement | null,
): boolean {
  const element = targetToElement(target);
  if (!root || !element || !isRenderedTranscriptRoot(root)) {
    return false;
  }

  const chatRoot = root.closest<HTMLElement>('[data-focus-zone="chat"]');
  if (!chatRoot) {
    return false;
  }

  if (element === document.body || element === document.documentElement) {
    const renderedRoots = Array.from(
      document.querySelectorAll<HTMLElement>('[data-chat-transcript-root="true"]'),
    ).filter(isRenderedTranscriptRoot);
    return renderedRoots.length === 1 && renderedRoots[0] === root;
  }

  return chatRoot.contains(element);
}

function isRenderedTranscriptRoot(root: HTMLElement): boolean {
  if (!root.isConnected) {
    return false;
  }

  let current: HTMLElement | null = root;
  while (current) {
    if (
      current.hidden
      || current.hasAttribute("inert")
      || current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    current = current.parentElement;
  }
  return true;
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
