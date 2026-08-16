import { useEffect } from "react";
import { $getRoot, $getSelection, $isRangeSelection } from "lexical";
import { createDOMRange } from "@lexical/selection";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

/**
 * WebKit can clear the document selection while the composer keeps DOM focus —
 * closing the native attach-file dialog and cancelled external drags both do
 * it. A focused contenteditable with no DOM range emits no beforeinput at all
 * in WebKit, so every keystroke dies while the caret still looks live
 * (PRO-294). Chromium reseats a selection on its own; WebKit never does, and
 * because focus never left, no blur/focus cycle runs that would repair it.
 * Rebuild the DOM selection from the editor state's last selection on the
 * first keystroke that should produce input. Modifier chords stay untouched
 * so a ⌘C over a transcript selection made while the composer holds focus
 * still copies that selection.
 */
export function ComposerSelectionRecoveryPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (event.key.length !== 1 && event.key !== "Backspace" && event.key !== "Delete") return;
      if (editor.isComposing() || !editor.isEditable()) return;
      const root = editor.getRootElement();
      if (root === null || root.ownerDocument.activeElement !== root) return;
      const domSelection = root.ownerDocument.defaultView?.getSelection() ?? null;
      if (domSelection === null) return;
      if (
        domSelection.rangeCount > 0
        && root.contains(domSelection.getRangeAt(0).startContainer)
      ) return;
      const range = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        return createDOMRange(
          editor,
          selection.anchor.getNode(),
          selection.anchor.offset,
          selection.focus.getNode(),
          selection.focus.offset,
        );
      });
      if (range !== null) {
        // Applying the range fires selectionchange, which syncs Lexical the
        // same way a user click would; the keystroke's own beforeinput then
        // lands on the restored caret.
        domSelection.removeAllRanges();
        domSelection.addRange(range);
        return;
      }
      editor.update(() => { $getRoot().selectEnd(); });
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("keydown", handleKeyDown);
      rootElement?.addEventListener("keydown", handleKeyDown);
    });
  }, [editor]);

  return null;
}
