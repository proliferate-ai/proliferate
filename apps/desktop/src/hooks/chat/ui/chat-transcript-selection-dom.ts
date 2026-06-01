import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "@proliferate/product-domain/chats/transcript/transcript-selection";

export function getTargetFacts(
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

export function setCollapsedRootMarker(root: HTMLElement): void {
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

export function isCollapsedRootMarkerSelection(
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

export function isExactRootSelection(selection: Selection, root: HTMLElement): boolean {
  if (selection.rangeCount !== 1) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const rootRange = document.createRange();
  rootRange.selectNodeContents(root);
  return range.compareBoundaryPoints(Range.START_TO_START, rootRange) === 0
    && range.compareBoundaryPoints(Range.END_TO_END, rootRange) === 0;
}

export function nodeInsideRoot(node: Node | null, root: HTMLElement): boolean {
  return !!node && root.contains(node);
}

export function getSelectionDirection(selection: Selection): "forward" | "backward" {
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

export function clampSelectionToRoot(
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
