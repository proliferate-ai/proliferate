import { useCallback, useEffect, type KeyboardEvent } from "react";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { $createLinkNode, $toggleLink, LinkNode } from "@lexical/link";
import { $isListItemNode, ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

const INPUT_TRANSFORMERS: Transformer[] = [
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
];
const OUTPUT_TRANSFORMERS: Transformer[] = [...INPUT_TRANSFORMERS, LINK];
const EXACT_HTTPS_URL = /^https:\/\/[^\s]+$/u;

export function isExactHttpsComposerPaste(value: string): boolean {
  return EXACT_HTTPS_URL.test(value);
}

export interface ComposerRichTextEditorProps {
  value: string;
  onChange: (markdown: string, eventTimeStampMs?: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPlainTextChange?: (text: string) => void;
  editorRef?: (editor: LexicalEditor) => void;
  placeholder: string;
  disabled: boolean;
  className?: string;
}

export function ComposerRichTextEditor({
  value,
  onChange,
  onKeyDown,
  onPlainTextChange,
  editorRef,
  placeholder,
  disabled,
  className = "",
}: ComposerRichTextEditorProps) {
  const initialConfig = {
    namespace: "ProliferateChatComposer",
    nodes: [ListNode, ListItemNode, LinkNode],
    editable: !disabled,
    theme: {
      paragraph: "m-0 min-h-[1lh]",
      text: {
        bold: "font-semibold",
        italic: "italic",
      },
      list: {
        ul: "list-disc pl-5",
        ol: "list-decimal pl-5",
        nested: { listitem: "list-none" },
      },
      link: "text-link-foreground underline decoration-current decoration-[0.5px]",
    },
    editorState: () => {
      if (value) $convertFromMarkdownString(value, INPUT_TRANSFORMERS);
    },
    onError(error: Error) {
      throw error;
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={(
          <ContentEditable
            data-chat-composer-editor
            data-telemetry-mask
            aria-placeholder={placeholder}
            placeholder={<></>}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              if (isExactHttpsComposerPaste(event.clipboardData.getData("text/plain"))) {
                event.stopPropagation();
              }
            }}
            className={`relative w-full resize-none bg-transparent text-[length:var(--text-composer)] leading-[var(--text-composer--line-height)] text-foreground outline-none ${disabled ? "opacity-60" : ""} ${className}`}
          />
        )}
        placeholder={(
          <div className="pointer-events-none absolute inset-x-0 top-0 truncate text-[length:var(--text-composer)] leading-[var(--text-composer--line-height)] text-muted-foreground">
            {placeholder}
          </div>
        )}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <ListIndentationPlugin />
      <MarkdownShortcutPlugin transformers={INPUT_TRANSFORMERS} />
      <HttpsPastePlugin />
      <ComposerEditorBridge
        value={value}
        disabled={disabled}
        onChange={onChange}
        onPlainTextChange={onPlainTextChange}
        editorRef={editorRef}
      />
    </LexicalComposer>
  );
}

function ComposerEditorBridge({
  value,
  disabled,
  onChange,
  onPlainTextChange,
  editorRef,
}: Pick<ComposerRichTextEditorProps, "value" | "disabled" | "onChange" | "onPlainTextChange" | "editorRef">) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    editorRef?.(editor);
  }, [editor, editorRef]);

  useEffect(() => {
    let current = "";
    editor.getEditorState().read(() => {
      current = $convertToMarkdownString(OUTPUT_TRANSFORMERS);
    });
    if (current === value) return;
    editor.update(() => {
      $getRoot().clear();
      if (value) $convertFromMarkdownString(value, INPUT_TRANSFORMERS);
      $getRoot().selectEnd();
    }, { tag: "external-composer-value" });
  }, [editor, value]);

  const handleChange = useCallback((editorState: EditorState, _nextEditor: LexicalEditor, tags: Set<string>) => {
    if (tags.has("external-composer-value")) return;
    editorState.read(() => {
      onPlainTextChange?.($getRoot().getTextContent());
      onChange($convertToMarkdownString(OUTPUT_TRANSFORMERS));
    });
  }, [onChange, onPlainTextChange]);

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}

function HttpsPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      const clipboard = "clipboardData" in event ? event.clipboardData : null;
      const url = clipboard?.getData("text/plain") ?? "";
      if (!isExactHttpsComposerPaste(url)) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      event.preventDefault();
      if (!selection.isCollapsed()) {
        $toggleLink(url);
      } else {
        const link = $createLinkNode(url);
        link.append($createTextNode(url));
        $insertNodes([link]);
        link.selectEnd();
      }
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor]);

  return null;
}

function ListIndentationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    KEY_TAB_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      let node = selection.anchor.getNode();
      while (node && !$isListItemNode(node)) {
        const parent = node.getParent();
        if (!parent) return false;
        node = parent;
      }
      if (!$isListItemNode(node)) return false;
      event.preventDefault();
      return editor.dispatchCommand(
        event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
        undefined,
      );
    },
    COMMAND_PRIORITY_EDITOR,
  ), [editor]);

  return null;
}

export function replaceComposerMarkdown(editor: LexicalEditor, markdown: string) {
  editor.update(() => {
    $getRoot().clear();
    if (markdown) $convertFromMarkdownString(markdown, INPUT_TRANSFORMERS);
    $getRoot().selectEnd();
  }, { tag: "external-composer-value" });
}
