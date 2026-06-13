import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
} from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  applyScratchListEnterFormatting,
} from "@/lib/domain/workspaces/scratch/scratch-list-formatting";
import {
  disabledExtensions,
  scratchEditorTheme,
  scratchHighlightStyle,
  scratchListDecorations,
  scratchMarkdownLanguage,
  wordWrapExtension,
} from "@/hooks/workspaces/lifecycle/scratch-codemirror-extensions";
import { scratchLivePreview } from "@/hooks/workspaces/lifecycle/scratch-codemirror-live-preview";

interface UseScratchCodeMirrorEditorOptions {
  hostRef: RefObject<HTMLDivElement | null>;
  value: string;
  placeholderText: string;
  disabled: boolean;
  wordWrap: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export function useScratchCodeMirrorEditor({
  hostRef,
  value,
  placeholderText,
  disabled,
  wordWrap,
  onChange,
  onBlur,
}: UseScratchCodeMirrorEditorOptions) {
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const disabledRef = useRef(disabled);
  const placeholderCompartmentRef = useRef(new Compartment());
  const disabledCompartmentRef = useRef(new Compartment());
  const wordWrapCompartmentRef = useRef(new Compartment());

  valueRef.current = value;
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  disabledRef.current = disabled;

  const insertTextAtSelection = useCallback((text: string, options: { ensureLineStart: boolean }) => {
    const view = viewRef.current;
    if (!view) {
      return false;
    }

    const selection = view.state.selection.main;
    const prefix = view.state.doc.sliceString(0, selection.from);
    const needsLeadingNewline = options.ensureLineStart
      && prefix.length > 0
      && !prefix.endsWith("\n");
    const insertion = `${needsLeadingNewline ? "\n" : ""}${text}`;
    const caret = selection.from + insertion.length;

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: insertion,
      },
      selection: {
        anchor: caret,
        head: caret,
      },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }, []);

  // Owns the imperative CodeMirror editor lifecycle and keeps React as the source of saved text.
  const extensions = useMemo(() => [
    history(),
    scratchMarkdownLanguage(),
    syntaxHighlighting(scratchHighlightStyle),
    scratchLivePreview,
    placeholderCompartmentRef.current.of(placeholder(placeholderText)),
    scratchEditorTheme,
    scratchListDecorations,
    disabledCompartmentRef.current.of(disabledExtensions(disabled)),
    wordWrapCompartmentRef.current.of(wordWrapExtension(wordWrap)),
    EditorView.domEventHandlers({
      blur: () => {
        onBlurRef.current();
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }
      const next = update.state.doc.toString();
      valueRef.current = next;
      onChangeRef.current(next);
    }),
    keymap.of([
      {
        key: "Enter",
        run: (view) => {
          if (disabledRef.current) {
            return false;
          }
          const selection = view.state.selection.main;
          const result = applyScratchListEnterFormatting({
            value: view.state.doc.toString(),
            selectionStart: selection.from,
            selectionEnd: selection.to,
          });
          if (!result) {
            return false;
          }
          view.dispatch({
            changes: result.changes,
            selection: {
              anchor: result.selectionStart,
              head: result.selectionEnd,
            },
            scrollIntoView: true,
          });
          return true;
        },
      },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ], []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions,
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
  }, [extensions, hostRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: [
        placeholderCompartmentRef.current.reconfigure(placeholder(placeholderText)),
        disabledCompartmentRef.current.reconfigure(disabledExtensions(disabled)),
        wordWrapCompartmentRef.current.reconfigure(wordWrapExtension(wordWrap)),
      ],
    });
  }, [disabled, placeholderText, wordWrap]);

  return useMemo(() => ({
    insertTextAtSelection,
  }), [insertTextAtSelection]);
}
