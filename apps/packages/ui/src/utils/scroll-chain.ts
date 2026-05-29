const SCROLL_EDGE_EPSILON = 1;

export function chainVerticalWheelScroll(
  element: HTMLElement,
  deltaY: number,
): boolean {
  if (deltaY === 0 || !isAtVerticalScrollEdge(element, deltaY)) {
    return false;
  }

  const parent = findScrollableParent(element);
  if (!parent) {
    return false;
  }

  const previousScrollTop = parent.scrollTop;
  parent.scrollTop += deltaY;
  return parent.scrollTop !== previousScrollTop;
}

function isAtVerticalScrollEdge(element: HTMLElement, deltaY: number): boolean {
  const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
  if (maxScrollTop <= SCROLL_EDGE_EPSILON) {
    return true;
  }

  if (deltaY < 0) {
    return element.scrollTop <= SCROLL_EDGE_EPSILON;
  }

  return element.scrollTop >= maxScrollTop - SCROLL_EDGE_EPSILON;
}

function findScrollableParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    if (canScrollVertically(current)) {
      return current;
    }
    current = current.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  return scrollingElement instanceof HTMLElement && canScrollVertically(scrollingElement)
    ? scrollingElement
    : null;
}

function canScrollVertically(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + SCROLL_EDGE_EPSILON) {
    return false;
  }

  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}
