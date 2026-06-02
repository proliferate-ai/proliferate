import { useEffect } from "react";

export function useDismissComposerPopover(
  open: boolean,
  rootRef: { readonly current: HTMLElement | null },
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const ownerDocument = rootRef.current?.ownerDocument ?? document;

    function eventTargetIsInsideRoot(target: EventTarget | null): boolean {
      return target instanceof Node
        && Boolean(rootRef.current?.contains(target));
    }

    function handlePointerDown(event: PointerEvent) {
      if (!eventTargetIsInsideRoot(event.target)) {
        onClose();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!eventTargetIsInsideRoot(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.addEventListener("focusin", handleFocusIn, true);
    ownerDocument.addEventListener("keydown", handleKeyDown, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.removeEventListener("focusin", handleFocusIn, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose, open, rootRef]);
}
