import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  parseScratchMarkdownListPrefix,
} from "@/lib/domain/workspaces/scratch/scratch-list-formatting";

export function scratchMarkdownLanguage() {
  return markdown({
    addKeymap: false,
    base: markdownLanguage,
    // A lone "-"/"=" under a paragraph otherwise reparses the previous line as
    // a setext heading, bolding it mid-typing when starting a bullet.
    extensions: [{ remove: ["SetextHeading"] }],
  });
}

export const scratchHighlightStyle = HighlightStyle.define([
  // Heading scale/spacing lives on the line (see scratchEditorTheme) so it
  // survives the caret revealing the raw "#"; here we only carry weight/colour.
  { tag: tags.heading, color: "var(--color-foreground)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--color-muted-foreground)" },
  { tag: tags.link, color: "var(--color-foreground)", textDecoration: "underline" },
  {
    tag: tags.monospace,
    color: "var(--color-foreground)",
    fontFamily: "var(--scratch-code-font-family)",
    fontSize: "0.9em",
  },
]);

export const scratchEditorTheme = EditorView.theme({
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
    // drawSelection() paints the caret as a .cm-cursor element; hide the native
    // one so we don't get two carets.
    caretColor: "transparent",
    fontFamily: "inherit",
    lineHeight: "var(--scratch-line-height)",
  },
  ".cm-line": {
    padding: "0",
    lineHeight: "var(--scratch-line-height)",
  },
  ".cm-line.scratch-heading": {
    fontWeight: "600",
    paddingTop: "0.7em",
    paddingBottom: "0.1em",
  },
  // The first line shouldn't carry top space on top of the content padding.
  ".cm-content > .cm-line:first-child.scratch-heading": {
    paddingTop: "0",
  },
  ".cm-line.scratch-heading-1": { fontSize: "1.5em", lineHeight: "1.3" },
  ".cm-line.scratch-heading-2": { fontSize: "1.28em", lineHeight: "1.3" },
  ".cm-line.scratch-heading-3": { fontSize: "1.14em", lineHeight: "1.35" },
  ".cm-line.scratch-heading-4": { fontSize: "1.05em", lineHeight: "1.4" },
  ".cm-line.scratch-heading-5": { fontSize: "1em", lineHeight: "1.45" },
  ".cm-line.scratch-heading-6": {
    fontSize: "0.95em",
    lineHeight: "1.45",
    color: "var(--color-muted-foreground)",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-foreground)",
    borderLeftWidth: "1px",
    // Match the caret to the text's own height (ascender→baseline), centred in
    // the line box, instead of the full line-height. Scales with headings.
    height: "1em !important",
    marginTop: "0.33em",
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
  ".scratch-inline-code": {
    backgroundColor: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
    border: "1px solid color-mix(in oklab, var(--color-foreground) 8%, transparent)",
    borderRadius: "0.35em",
    padding: "0.03em 0.32em",
    // Keep the chip from stretching the line box and clone its box when it wraps.
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
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

export function disabledExtensions(disabled: boolean) {
  return [
    EditorView.editable.of(!disabled),
    EditorState.readOnly.of(disabled),
  ];
}

export function wordWrapExtension(wordWrap: boolean) {
  return wordWrap ? EditorView.lineWrapping : [];
}

export const scratchListDecorations = ViewPlugin.fromClass(class {
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
