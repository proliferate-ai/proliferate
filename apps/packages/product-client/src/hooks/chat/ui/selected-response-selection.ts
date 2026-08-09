import type { SelectedResponseSelection } from "#product/domain/chats/transcript/selected-response-context";

export function getSelectedAssistantResponse(
  selection: Selection,
  root: HTMLElement,
): SelectedResponseSelection | null {
  if (selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const text = selection.toString();
  if (text.trim().length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startElement = nodeToElement(range.startContainer);
  const endElement = nodeToElement(range.endContainer);
  if (
    !startElement
    || !endElement
    || startElement.closest("[data-chat-transcript-ignore]")
    || endElement.closest("[data-chat-transcript-ignore]")
  ) {
    return null;
  }
  const startResponse = startElement.closest("[data-assistant-prose]");
  const endResponse = endElement.closest("[data-assistant-prose]");
  if (
    !startResponse
    || startResponse !== endResponse
    || !root.contains(startResponse)
  ) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const width = Number.isFinite(rect.width) ? rect.width : 0;
  const height = Number.isFinite(rect.height) ? rect.height : 0;
  const right = Number.isFinite(rect.right) ? rect.right : left + width;
  const bottom = Number.isFinite(rect.bottom) ? rect.bottom : top + height;

  return {
    text,
    anchorRect: {
      x: Number.isFinite(rect.x) ? rect.x : left,
      y: Number.isFinite(rect.y) ? rect.y : top,
      width,
      height,
      top,
      right,
      bottom,
      left,
    },
  };
}

export function isSelectedResponseInViewport(
  selection: SelectedResponseSelection,
  root?: HTMLElement,
): boolean {
  const { anchorRect } = selection;
  const visibleBounds = clippingBoundsForElement(root);
  return anchorRect.bottom > visibleBounds.top
    && anchorRect.right > visibleBounds.left
    && anchorRect.top < visibleBounds.bottom
    && anchorRect.left < visibleBounds.right;
}

function clippingBoundsForElement(root?: HTMLElement) {
  const bounds = {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    left: 0,
  };
  for (let element: HTMLElement | null = root ?? null; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    const overflowX = style.overflowX || style.overflow;
    const overflowY = style.overflowY || style.overflow;
    const clipsX = clipsOverflow(overflowX);
    const clipsY = clipsOverflow(overflowY);
    if (!clipsX && !clipsY) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (clipsX) {
      bounds.left = Math.max(bounds.left, rect.left);
      bounds.right = Math.min(bounds.right, rect.right);
    }
    if (clipsY) {
      bounds.top = Math.max(bounds.top, rect.top);
      bounds.bottom = Math.min(bounds.bottom, rect.bottom);
    }
  }
  return bounds;
}

function clipsOverflow(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "hidden" || value === "clip";
}

function nodeToElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}
