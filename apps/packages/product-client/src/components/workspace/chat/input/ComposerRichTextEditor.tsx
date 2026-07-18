import { useEffect, useRef, type MutableRefObject, type Ref } from "react";
import {
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
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
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ComposerCaretPlugin } from "#product/components/workspace/chat/input/ComposerCaretPlugin";
import type { ComposerKeyboardEventLike } from "#product/lib/domain/chat/composer/composer-keyboard";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";

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
const MARKDOWN_HTTPS_LINK = /\[([^\]\r\n]+)\]\((https:\/\/[^\s)\r\n]+)\)/gu;
const EXTERNAL_VALUE_TAG = "external-composer-value";

type ComposerNativeKeyboardEvent = KeyboardEvent & ComposerKeyboardEventLike;

export interface ComposerEditorContext {
  plainText: string;
  anchorOffset: number;
  focusOffset: number;
}

export function isExactHttpsComposerPaste(value: string): boolean {
  return EXACT_HTTPS_URL.test(value);
}

type ComposerPastePart =
  | { kind: "text"; value: string }
  | { kind: "link"; label: string; url: string };

export function parseMarkdownHttpsComposerPaste(value: string): ComposerPastePart[] | null {
  const parts: ComposerPastePart[] = [];
  let cursor = 0;
  let containsLink = false;

  for (const match of value.matchAll(MARKDOWN_HTTPS_LINK)) {
    const matchIndex = match.index;
    const label = match[1];
    const url = match[2];
    if (matchIndex === undefined || label === undefined || url === undefined) continue;
    if (matchIndex > cursor) {
      parts.push({ kind: "text", value: value.slice(cursor, matchIndex) });
    }
    parts.push({ kind: "link", label, url });
    containsLink = true;
    cursor = matchIndex + match[0].length;
  }

  if (!containsLink) return null;
  if (cursor < value.length) parts.push({ kind: "text", value: value.slice(cursor) });
  return parts;
}

export function isComposerLinkPaste(value: string): boolean {
  return isExactHttpsComposerPaste(value) || parseMarkdownHttpsComposerPaste(value) !== null;
}

export interface ComposerRichTextEditorProps {
  value: string;
  snapshot?: ChatComposerEditorSnapshot;
  onChange: (
    markdown: string,
    eventTimeStampMs: number | undefined,
    snapshot: ChatComposerEditorSnapshot,
  ) => void;
  onEditorContextChange?: (context: ComposerEditorContext) => void;
  onKeyDown?: (event: ComposerKeyboardEventLike & { defaultPrevented: boolean; preventDefault(): void; currentTarget: EventTarget | null }) => void;
  onCommandKey?: (event: KeyboardEvent) => boolean;
  submitBehavior: "workspace" | "home" | "editing";
  canSubmit: boolean;
  onSubmit: () => void;
  editorRef?: (editor: LexicalEditor) => void;
  rootRef?: Ref<HTMLDivElement>; surface?: "workspace" | "home";
  placeholder: string;
  disabled: boolean;
  className?: string;
}

export function ComposerRichTextEditor({
  value,
  snapshot,
  onChange,
  onEditorContextChange,
  onKeyDown,
  onCommandKey,
  submitBehavior,
  canSubmit,
  onSubmit,
  editorRef, rootRef, surface = "workspace",
  placeholder,
  disabled,
  className = "",
}: ComposerRichTextEditorProps) {
  const eventTimeStampRef = useRef<number | undefined>(undefined);
  const initialConfig = {
    namespace: "ProliferateChatComposer",
    nodes: [ListNode, ListItemNode, LinkNode],
    editable: !disabled,
    theme: {
      paragraph: "m-0 min-h-[1lh]",
      text: { bold: "font-semibold", italic: "italic" },
      list: {
        ul: "list-disc pl-5",
        ol: "list-decimal pl-5",
        nested: { listitem: "list-none" },
      },
      link: "text-link-foreground underline decoration-current decoration-[0.5px]",
    },
    editorState: snapshot?.version === 1
      ? snapshot.payload
      : () => { $convertFromMarkdownString(value, INPUT_TRANSFORMERS); },
    onError(error: Error) { throw error; },
  };
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={(
          <ContentEditable
            data-chat-composer-editor
            data-home-composer-editor={surface === "home" ? true : undefined}
            data-telemetry-mask
            ref={rootRef}
            aria-placeholder={placeholder}
            placeholder={<></>}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Tab" || event.defaultPrevented) return;
              onKeyDown?.(event);
            }}
            onPaste={(event) => {
              if (isComposerLinkPaste(event.clipboardData.getData("text/plain"))) {
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
      <MarkdownShortcutPlugin transformers={INPUT_TRANSFORMERS} />
      <ComposerBehaviorPlugin
        submitBehavior={submitBehavior}
        canSubmit={canSubmit}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onCommandKey={onCommandKey}
      />
      <ComposerLinkPastePlugin />
      <ComposerCaretPlugin />
      <ComposerNativeEventTimestampPlugin eventTimeStampRef={eventTimeStampRef} />
      <ComposerEditorBridge
        value={value}
        snapshot={snapshot}
        disabled={disabled}
        onChange={onChange}
        onEditorContextChange={onEditorContextChange}
        editorRef={editorRef}
        eventTimeStampRef={eventTimeStampRef}
      />
    </LexicalComposer>
  );
}

function ComposerNativeEventTimestampPlugin({
  eventTimeStampRef,
}: {
  eventTimeStampRef: MutableRefObject<number | undefined>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const captureTimeStamp = (event: Event) => {
      const eventTimeStampMs = event.timeStamp;
      eventTimeStampRef.current = eventTimeStampMs;
      queueMicrotask(() => {
        if (eventTimeStampRef.current === eventTimeStampMs) eventTimeStampRef.current = undefined;
      });
    };
    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("beforeinput", captureTimeStamp, true);
      previousRootElement?.removeEventListener("keydown", captureTimeStamp, true);
      previousRootElement?.removeEventListener("paste", captureTimeStamp, true);
      rootElement?.addEventListener("beforeinput", captureTimeStamp, true);
      rootElement?.addEventListener("keydown", captureTimeStamp, true);
      rootElement?.addEventListener("paste", captureTimeStamp, true);
    });
  }, [editor, eventTimeStampRef]);

  return null;
}

function ComposerEditorBridge({
  value,
  snapshot,
  disabled,
  onChange,
  onEditorContextChange,
  editorRef,
  eventTimeStampRef,
}: Pick<ComposerRichTextEditorProps, "value" | "snapshot" | "disabled" | "onChange" | "onEditorContextChange" | "editorRef"> & {
  eventTimeStampRef: MutableRefObject<number | undefined>;
}) {
  const [editor] = useLexicalComposerContext();
  const lastDocumentPayloadRef = useRef(JSON.stringify(editor.getEditorState().toJSON()));
  const lastMarkdownRef = useRef(value);

  useEffect(() => { editor.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => { editorRef?.(editor); }, [editor, editorRef]);

  useEffect(() => {
    if (
      value === lastMarkdownRef.current
      && (snapshot?.version !== 1 || snapshot.payload === lastDocumentPayloadRef.current)
    ) return;

    const currentPayload = JSON.stringify(editor.getEditorState().toJSON());
    if (snapshot?.version === 1 && snapshot.payload !== currentPayload) {
      lastMarkdownRef.current = value;
      editor.setEditorState(editor.parseEditorState(snapshot.payload), { tag: EXTERNAL_VALUE_TAG });
      return;
    }
    let currentMarkdown = "";
    editor.getEditorState().read(() => { currentMarkdown = $convertToMarkdownString(OUTPUT_TRANSFORMERS); });
    if (currentMarkdown === value) {
      lastMarkdownRef.current = value;
      return;
    }
    lastMarkdownRef.current = value;
    editor.update(() => {
      $getRoot().clear();
      if (value) $convertFromMarkdownString(value, INPUT_TRANSFORMERS);
      $getRoot().selectEnd();
    }, { tag: EXTERNAL_VALUE_TAG });
  }, [editor, snapshot, value]);

  useEffect(() => editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    editorState.read(() => {
      onEditorContextChange?.(readEditorContext());
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      const payload = JSON.stringify(editorState.toJSON());
      if (payload === lastDocumentPayloadRef.current) return;
      lastDocumentPayloadRef.current = payload;
      if (tags.has(EXTERNAL_VALUE_TAG)) return;
      const eventTimeStampMs = eventTimeStampRef.current;
      eventTimeStampRef.current = undefined;
      const markdown = $convertToMarkdownString(OUTPUT_TRANSFORMERS);
      lastMarkdownRef.current = markdown;
      onChange(
        markdown,
        eventTimeStampMs,
        { version: 1, payload },
      );
    });
  }), [editor, eventTimeStampRef, onChange, onEditorContextChange]);

  return null;
}

function ComposerBehaviorPlugin({
  submitBehavior,
  canSubmit,
  onSubmit,
  onKeyDown,
  onCommandKey,
}: Pick<ComposerRichTextEditorProps, "submitBehavior" | "canSubmit" | "onSubmit" | "onKeyDown" | "onCommandKey">) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (!event || event.defaultPrevented || event.isComposing) return false;
      if (onCommandKey?.(event)) return true;
      const inList = selectionIsInList();
      const plainEnter = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const primaryEnter = !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
      if (plainEnter && inList) return false;
      const ownsSubmit = submitBehavior === "home" ? primaryEnter : plainEnter || primaryEnter;
      if (!ownsSubmit) return false;
      event.preventDefault();
      if (!event.repeat && canSubmit) onSubmit();
      return true;
    }, COMMAND_PRIORITY_HIGH);
    const unregisterTab = editor.registerCommand(KEY_TAB_COMMAND, (event) => {
      if (event.defaultPrevented || event.isComposing) return false;
      if (onCommandKey?.(event)) return true;
      if (!selectionIsInList()) {
        onKeyDown?.(event as ComposerNativeKeyboardEvent);
        return event.defaultPrevented;
      }
      event.preventDefault();
      return editor.dispatchCommand(
        event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
        undefined,
      );
    }, COMMAND_PRIORITY_HIGH);
    return () => { unregisterEnter(); unregisterTab(); };
  }, [canSubmit, editor, onCommandKey, onKeyDown, onSubmit, submitBehavior]);

  return null;
}

function ComposerLinkPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    const clipboard = "clipboardData" in event ? event.clipboardData : null;
    const value = clipboard?.getData("text/plain") ?? "";
    const markdownParts = parseMarkdownHttpsComposerPaste(value);
    const isExactUrl = isExactHttpsComposerPaste(value);
    if (!isExactUrl && markdownParts === null) return false;
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    event.preventDefault();

    if (isExactUrl) {
      if (!selection.isCollapsed()) {
        $toggleLink(value);
        return true;
      }
      const link = $createLinkNode(value);
      link.append($createTextNode(value));
      $insertNodes([link]);
      link.selectEnd();
      return true;
    }

    const nodes = markdownParts!.map((part) => {
      if (part.kind === "text") return $createTextNode(part.value);
      const link = $createLinkNode(part.url);
      link.append($createTextNode(part.label));
      return link;
    });
    $insertNodes(nodes);
    nodes[nodes.length - 1]?.selectEnd();
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor]);
  return null;
}

function selectionIsInList(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  let node = selection.anchor.getNode();
  while (node && !$isListItemNode(node)) {
    const parent = node.getParent();
    if (!parent) return false;
    node = parent;
  }
  return $isListItemNode(node);
}

function readEditorContext(): ComposerEditorContext {
  const selection = $getSelection();
  const plainText = $getRoot().getTextContent();
  if (!$isRangeSelection(selection)) return { plainText, anchorOffset: plainText.length, focusOffset: plainText.length };
  return {
    plainText,
    anchorOffset: globalPointOffset(selection.anchor.getNode(), selection.anchor.offset),
    focusOffset: globalPointOffset(selection.focus.getNode(), selection.focus.offset),
  };
}

export function getComposerEditorContext(editor: LexicalEditor): ComposerEditorContext {
  let context: ComposerEditorContext = { plainText: "", anchorOffset: 0, focusOffset: 0 };
  editor.getEditorState().read(() => { context = readEditorContext(); });
  return context;
}

function globalPointOffset(node: LexicalNode, localOffset: number): number {
  let offset = 0;
  for (const textNode of $getRoot().getAllTextNodes()) {
    if (textNode.is(node)) return offset + localOffset;
    offset += textNode.getTextContentSize();
  }
  return offset;
}

function pointAtOffset(offset: number): { node: TextNode; offset: number } | null {
  const nodes = $getRoot().getAllTextNodes();
  let traversed = 0;
  for (const node of nodes) {
    const end = traversed + node.getTextContentSize();
    if (offset <= end) return { node, offset: Math.max(0, offset - traversed) };
    traversed = end;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.getTextContentSize() } : null;
}

export function replaceComposerTextRange(
  editor: LexicalEditor,
  start: number,
  end: number,
  replacement: string,
) {
  editor.update(() => {
    const anchor = pointAtOffset(start);
    const focus = pointAtOffset(end);
    if (!anchor || !focus) return;
    const selection = $createRangeSelection();
    selection.setTextNodeRange(anchor.node, anchor.offset, focus.node, focus.offset);
    $setSelection(selection);
    selection.insertText(replacement);
  });
}
