import { useEffect } from "react";
import { $getSelection, $isRangeSelection } from "lexical";
import {
  registerMarkdownShortcuts,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { isComposerSelectionPointInsideCode } from "#product/components/workspace/chat/input/ComposerEditorDocument";

/** Keeps Markdown shortcuts literal while a structural or raw fence owns the caret. */
export function ComposerMarkdownShortcutPlugin({
  transformers,
}: {
  transformers: Transformer[];
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let removeShortcuts: (() => void) | null = registerMarkdownShortcuts(
      editor,
      transformers,
    );
    const syncShortcuts = () => {
      const shouldEnable = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return true;
        return !isComposerSelectionPointInsideCode(
          selection.anchor.getNode(),
          selection.anchor.offset,
        ) && !isComposerSelectionPointInsideCode(
          selection.focus.getNode(),
          selection.focus.offset,
        );
      });
      if (shouldEnable && !removeShortcuts) {
        removeShortcuts = registerMarkdownShortcuts(editor, transformers);
      } else if (!shouldEnable && removeShortcuts) {
        removeShortcuts();
        removeShortcuts = null;
      }
    };

    const removeRootListener = editor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener("beforeinput", syncShortcuts, true);
      root?.addEventListener("beforeinput", syncShortcuts, true);
    });
    return () => {
      removeRootListener();
      removeShortcuts?.();
    };
  }, [editor, transformers]);

  return null;
}
