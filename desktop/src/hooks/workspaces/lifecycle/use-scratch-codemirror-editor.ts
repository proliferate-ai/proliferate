import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  applyScratchListEnterFormatting,
  parseScratchMarkdownListPrefix,
} from "@/lib/domain/workspaces/scratch/scratch-list-formatting";

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
    markdown({ addKeymap: false }),
    syntaxHighlighting(scratchHighlightStyle),
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

const scratchHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--color-foreground)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.link, color: "var(--color-foreground)", textDecoration: "underline" },
  {
    tag: tags.monospace,
    color: "var(--color-muted-foreground)",
    fontFamily: "var(--scratch-code-font-family)",
    fontSize: "0.93em",
  },
]);

const scratchEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-foreground)",
    backgroundColor: "transparent",
    fontFamily: "var(--scratch-font-family)",
    fontSize: "var(--scratch-font-size)",
    lineHeight: "var(--scratch-line-height)",
    fontWeight: "400",
    letterSpacing: "0",
  },
  ".cm-scroller": {
    height: "100%",
    overflow: "auto",
    fontFamily: "inherit",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "0.9rem 1.05rem",
    caretColor: "var(--color-foreground)",
    fontFamily: "inherit",
    lineHeight: "var(--scratch-line-height)",
  },
  ".cm-line": {
    padding: "0",
    lineHeight: "var(--scratch-line-height)",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-foreground)",
    borderLeftWidth: "1px",
    height: "1.25em !important",
    marginTop: "0.14em",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--color-foreground) 18%, transparent)",
  },
  ".cm-placeholder": {
    color: "color-mix(in oklab, var(--color-sidebar-muted-foreground) 65%, transparent)",
    display: "inline",
    fontFamily: "inherit",
    fontSize: "var(--scratch-font-size)",
    lineHeight: "var(--scratch-line-height)",
    whiteSpace: "normal",
  },
  ".scratch-list-marker": {
    display: "inline-flex",
    width: "var(--scratch-list-marker-width)",
    justifyContent: "center",
    color: "var(--color-sidebar-muted-foreground)",
  },
  ".scratch-task-checkbox": {
    display: "inline-block",
    width: "var(--scratch-list-marker-width)",
    height: "1em",
    margin: "0 0.1em 0 0",
    boxSizing: "border-box",
    lineHeight: "1",
    position: "relative",
    verticalAlign: "-0.1em",
  },
  ".scratch-task-box": {
    display: "block",
    width: "var(--scratch-task-box-size)",
    height: "var(--scratch-task-box-size)",
    boxSizing: "border-box",
    position: "absolute",
    left: "50%",
    top: "50%",
    border: "1px solid color-mix(in oklab, var(--color-sidebar-muted-foreground) 72%, transparent)",
    borderRadius: "0.18em",
    background: "transparent",
    color: "transparent",
    transform: "translate(-50%, -50%)",
  },
  ".scratch-task-checkbox[data-checked=\"true\"] .scratch-task-box": {
    borderColor: "color-mix(in oklab, var(--color-foreground) 68%, transparent)",
    background: "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
    color: "var(--color-foreground)",
  },
  ".scratch-task-check": {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "0.38em",
    height: "0.22em",
    border: "solid currentColor",
    borderWidth: "0 0 0.095em 0.095em",
    transform: "translate(-50%, -60%) rotate(-45deg)",
  },
});

function disabledExtensions(disabled: boolean) {
  return [
    EditorView.editable.of(!disabled),
    EditorState.readOnly.of(disabled),
  ];
}

function wordWrapExtension(wordWrap: boolean) {
  return wordWrap ? EditorView.lineWrapping : [];
}

const scratchListDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildScratchListDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildScratchListDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function buildScratchListDecorations(view: EditorView) {
  const decorations = [];
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const prefix = parseScratchMarkdownListPrefix(line.text);
      if (prefix) {
        const markerFrom = line.from + prefix.indent.length;
        const markerTo = line.from + prefix.prefixLength;
        const widget = prefix.kind === "task"
          ? new ScratchTaskWidget({
            checked: prefix.checked,
            checkboxPosition: line.from + (prefix.checkboxOffset ?? 0),
          })
          : new ScratchBulletWidget();
        decorations.push(Decoration.replace({
          widget,
          inclusive: false,
        }).range(markerFrom, markerTo));
      }
      if (line.to >= to || line.to === view.state.doc.length) {
        break;
      }
      position = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

class ScratchBulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "scratch-list-marker";
    marker.textContent = "•";
    return marker;
  }
}

class ScratchTaskWidget extends WidgetType {
  constructor(private readonly options: {
    checked: boolean;
    checkboxPosition: number;
  }) {
    super();
  }

  eq(other: ScratchTaskWidget) {
    return this.options.checked === other.options.checked
      && this.options.checkboxPosition === other.options.checkboxPosition;
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement("span");
    checkbox.className = "scratch-task-checkbox";
    checkbox.dataset.checked = String(this.options.checked);
    checkbox.role = "checkbox";
    checkbox.tabIndex = 0;
    checkbox.setAttribute("aria-checked", String(this.options.checked));
    checkbox.setAttribute("aria-label", this.options.checked ? "Mark task incomplete" : "Mark task complete");
    const box = document.createElement("span");
    box.className = "scratch-task-box";
    if (this.options.checked) {
      const check = document.createElement("span");
      check.className = "scratch-task-check";
      box.appendChild(check);
    }
    checkbox.appendChild(box);
    checkbox.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      toggleTaskCheckbox(view, this.options);
    });
    checkbox.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      toggleTaskCheckbox(view, this.options);
    });
    return checkbox;
  }

  ignoreEvent() {
    return false;
  }
}

function toggleTaskCheckbox(
  view: EditorView,
  options: {
    checked: boolean;
    checkboxPosition: number;
  },
) {
  view.dispatch({
    changes: {
      from: options.checkboxPosition,
      to: options.checkboxPosition + 1,
      insert: options.checked ? " " : "x",
    },
  });
}
