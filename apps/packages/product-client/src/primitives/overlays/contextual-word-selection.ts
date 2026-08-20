/**
 * macOS WebKit selects the word under the pointer while preparing a context
 * menu — inside the platform's sendContextMenuEvent, after mousedown but
 * before the DOM `contextmenu` event is dispatched — so no preventDefault on
 * either event stops it. A handler that replaces the browser menu calls this
 * synchronously to drop that just-made selection before it ever paints.
 *
 * Only a selection with BOTH endpoints inside `container` is cleared: the
 * WebKit contextual word selection is always fully inside the right-clicked
 * element, so a selection with one endpoint outside cannot be it — it is a
 * deliberate selection that merely touches the trigger, and clearing it
 * would destroy user intent.
 */
export function clearContextualWordSelection(container: EventTarget | null): void {
  if (!(container instanceof Element)) {
    return;
  }
  const selection = container.ownerDocument?.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  const { anchorNode, focusNode } = selection;
  const containedBoth =
    anchorNode !== null
    && focusNode !== null
    && container.contains(anchorNode)
    && container.contains(focusNode);
  if (containedBoth) {
    selection.removeAllRanges();
  }
}
