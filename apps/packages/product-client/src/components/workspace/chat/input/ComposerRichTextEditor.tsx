import { useEffect, useRef, type MutableRefObject, type Ref } from "react";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
} from "lexical";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ComposerCaretPlugin } from "#product/components/workspace/chat/input/ComposerCaretPlugin";
import { ComposerFencedCodePlugin } from "#product/components/workspace/chat/input/ComposerFencedCodePlugin";
import { ComposerFormatGuardPlugin } from "#product/components/workspace/chat/input/ComposerFormatGuardPlugin";
import {
  COMPOSER_INPUT_TRANSFORMERS,
  COMPOSER_NODES,
  COMPOSER_OUTPUT_TRANSFORMERS,
  readComposerEditorContext,
  type ComposerEditorContext,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";
import { ComposerLinkPastePlugin } from "#product/components/workspace/chat/input/ComposerLinkPastePlugin";
import { ComposerMarkdownShortcutPlugin } from "#product/components/workspace/chat/input/ComposerMarkdownShortcutPlugin";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "#product/config/transcript-link-styles";
import type { ComposerKeyboardEventLike } from "#product/lib/domain/chat/composer/composer-keyboard";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";

const INPUT_TRANSFORMERS = COMPOSER_INPUT_TRANSFORMERS;
const OUTPUT_TRANSFORMERS = COMPOSER_OUTPUT_TRANSFORMERS;
const EXTERNAL_VALUE_TAG = "external-composer-value";

type ComposerNativeKeyboardEvent = KeyboardEvent & ComposerKeyboardEventLike;

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
  /** Id of the highlighted row in an open inline menu, for aria-activedescendant. */
  activeDescendantId?: string;
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
  activeDescendantId,
  canSubmit,
  onSubmit,
  editorRef, rootRef, surface = "workspace",
  placeholder,
  disabled,
  className = "",
}: ComposerRichTextEditorProps) {
  const eventTimeStampRef = useRef<number | undefined>(undefined);
  const caretRef = useRef<HTMLSpanElement | null>(null);
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  const initialConfig = {
    namespace: "ProliferateChatComposer",
    nodes: COMPOSER_NODES,
    editable: !disabled,
    theme: {
      paragraph: "m-0 min-h-[1lh]",
      text: { bold: "font-semibold", italic: "italic" },
      // Recorded cause (DESIGN_SYSTEM.md § UI-conformance review, check 4): a
      // two-argument CSS fallback for the optional per-theme code-block
      // override. No token utility can express a fallback chain, and this
      // string must stay a plain class list because Lexical's theme map takes
      // one.
      code: "box-border my-2 block w-full min-w-0 max-w-full overflow-x-auto whitespace-pre rounded-lg border border-transparent bg-[var(--color-code-block-background,var(--color-card))] p-3 font-mono text-chat font-normal text-foreground",
      list: {
        ul: "list-disc pl-5",
        ol: "list-decimal pl-5",
        nested: { listitem: "list-none" },
      },
      link: CHAT_TRANSCRIPT_LINK_CLASS,
    },
    editorState: snapshot?.version === 1
      ? snapshot.payload
      : () => { $convertFromMarkdownString(value, INPUT_TRANSFORMERS); },
    onError(error: Error) { throw error; },
  };
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        ref={editorFrameRef}
        data-chat-composer-editor-frame
        className="relative min-h-[inherit]"
      >
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              data-chat-composer-editor
              data-home-composer-editor={surface === "home" ? true : undefined}
              data-telemetry-mask
              ref={rootRef}
              aria-activedescendant={activeDescendantId}
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
              className={`relative w-full resize-none bg-transparent text-composer text-foreground outline-none ${disabled ? "opacity-60" : ""} ${className}`}
            />
          )}
          placeholder={(
            // ui-foundation-escalation: [CHAT-03] wants the reference
            // placeholder ink, but neither reading of it is expressible in the
            // ruled vocabulary. The prose target is a tertiary/description
            // role (~49.8% white) while the actual implementation is a separate
            // placeholder-foreground token further multiplied by
            // `opacity: .5` (~25-35% effective) —
            // ui-foundation-chat-addendum.md [CHAT-03] flags exactly this split.
            // `text-foreground-tertiary` (--color-foreground-tertiary, 50%) is
            // the closest legal role and the addendum's recommendation; it
            // replaces `text-muted-foreground` (70%), which was too opaque
            // against either reading. Revisit if a placeholder-specific
            // foreground role is ever added to the authority.
            <div className="pointer-events-none absolute inset-x-0 top-0 truncate text-composer text-foreground-tertiary">
              {placeholder}
            </div>
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <span
          ref={caretRef}
          aria-hidden="true"
          data-chat-composer-caret
          style={{
            backgroundColor: "currentColor",
            display: "none",
            pointerEvents: "none",
            position: "absolute",
            width: "1px",
          }}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <ComposerMarkdownShortcutPlugin transformers={INPUT_TRANSFORMERS} />
      <ComposerFencedCodePlugin />
      <ComposerFormatGuardPlugin />
      <ComposerBehaviorPlugin
        canSubmit={canSubmit}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onCommandKey={onCommandKey}
      />
      <ComposerLinkPastePlugin markdownTransformers={OUTPUT_TRANSFORMERS} />
      <ComposerCaretPlugin caretRef={caretRef} frameRef={editorFrameRef} />
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
      // Reset inherited text formats along with the content: the selection's
      // format bits survive a root clear, so a code-formatted draft would
      // otherwise re-apply `code` to everything typed after a send (PRO-159).
      const selection = $getRoot().selectEnd();
      if (selection.format !== 0 || selection.style !== "") {
        selection.format = 0;
        selection.style = "";
        selection.dirty = true;
      }
    }, { tag: EXTERNAL_VALUE_TAG });
  }, [editor, snapshot, value]);

  useEffect(() => editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    editorState.read(() => {
      const context = readComposerEditorContext();
      onEditorContextChange?.(context);
      // Mirror "text is highlighted" onto the root so the global shortcut
      // dispatcher can cede ⌘B to the editor's bold chord without reading
      // DOM selection state; Lexical's selection is what bold applies to,
      // so it is the source of truth (PRO-265).
      editor.getRootElement()?.toggleAttribute(
        "data-chat-composer-highlight",
        context.anchorOffset !== context.focusOffset,
      );
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
  canSubmit,
  onSubmit,
  onKeyDown,
  onCommandKey,
}: Pick<ComposerRichTextEditorProps, "canSubmit" | "onSubmit" | "onKeyDown" | "onCommandKey">) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (!event || event.defaultPrevented || event.isComposing) return false;
      if (onCommandKey?.(event)) return true;
      const plainEnter = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const primaryEnter = !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
      const shiftEnter = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (shiftEnter && $exitListForShiftEnter(editor)) {
        event.preventDefault();
        return true;
      }
      if (!plainEnter && !primaryEnter) return false;
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
      if (event.shiftKey && $outdentTopLevelListItems()) return true;
      return editor.dispatchCommand(
        event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
        undefined,
      );
    }, COMMAND_PRIORITY_HIGH);
    return () => { unregisterEnter(); unregisterTab(); };
  }, [canSubmit, editor, onCommandKey, onKeyDown, onSubmit]);

  return null;
}

function selectionIsInList(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return $nearestListItem(selection.anchor.getNode()) !== null;
}

function $nearestListItem(node: LexicalNode): ListItemNode | null {
  let current: LexicalNode | null = node;
  while (current !== null && !$isListItemNode(current)) current = current.getParent();
  return $isListItemNode(current) ? current : null;
}

// Lexical's stock OUTDENT_CONTENT_COMMAND only shrinks nesting, so it is a
// silent no-op for items already at the top level (PRO-267). The missing
// outdent step — item becomes a paragraph, splitting its list around it — is
// owned here. Nested items (and wrapper items holding a nested list) still
// take Lexical's own outdent path.
function $outdentTopLevelListItems(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const items = new Set<ListItemNode>();
  for (const node of selection.getNodes()) {
    const item = $nearestListItem(node);
    if (item) items.add(item);
  }
  if (items.size === 0) return false;
  for (const item of items) {
    if (item.getIndent() > 0 || item.getChildren().some($isListNode)) return false;
  }
  for (const item of items) $convertListItemToParagraph(item);
  return true;
}

// Plain Enter submits the message, so Shift+Enter doubles as the list exit:
// on an empty item it leaves the list (or un-nests one level), and on an
// empty trailing line it moves the caret into a paragraph below the list.
function $exitListForShiftEnter(editor: LexicalEditor): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const item = $nearestListItem(selection.anchor.getNode());
  if (!item) return false;
  const effectivelyEmpty = item
    .getChildren()
    .every((child) => $isTextNode(child) && child.getTextContentSize() === 0);
  if (effectivelyEmpty) {
    if (item.getIndent() > 0) return editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
    $convertListItemToParagraph(item);
    return true;
  }
  if (item.getIndent() > 0) return false;
  const { anchor } = selection;
  const caretOnEmptyTrailingLine = $isLineBreakNode(item.getLastChild())
    && anchor.type === "element"
    && anchor.getNode().is(item)
    && anchor.offset === item.getChildrenSize();
  if (!caretOnEmptyTrailingLine) return false;
  item.getLastChild()?.remove();
  const list = item.getParentOrThrow();
  const trailingStart = $orderedStartAfter(item);
  const nextItem = item.getNextSibling();
  const paragraph = $createParagraphNode();
  item.insertAfter(paragraph);
  $healTrailingList(paragraph, nextItem, trailingStart);
  if (item.getChildrenSize() === 0) {
    item.remove();
    if (list.isAttached() && list.getChildrenSize() === 0) list.remove();
  }
  paragraph.selectEnd();
  return true;
}

function $convertListItemToParagraph(item: ListItemNode): void {
  const trailingStart = $orderedStartAfter(item);
  const nextItem = item.getNextSibling();
  // ListItemNode.replace splits the list around the item, transfers its
  // children, remaps an element-anchored caret, and prunes the emptied list.
  const paragraph = item.replace($createParagraphNode(), true);
  $healTrailingList(paragraph, nextItem, trailingStart);
}

// Visible number the items after `item` should keep once a paragraph lands
// before them, or null for unordered lists.
function $orderedStartAfter(item: ListItemNode): number | null {
  const list = item.getParent();
  if (!$isListNode(list) || list.getListType() !== "number") return null;
  return list.getStart() + item.getIndexWithinParent() + 1;
}

// After a paragraph lands between the halves of a split list, the trailing
// half restarts ordered numbering at the head's start, and when the exited
// item owned a nested sublist, that sublist's wrapper now leads the trailing
// half as an indented bullet with no parent. Repair both.
function $healTrailingList(
  paragraph: ParagraphNode,
  firstTrailingItem: LexicalNode | null,
  orderedStart: number | null,
): void {
  if (!$isListItemNode(firstTrailingItem)) return;
  const trailingList = firstTrailingItem.getParent();
  if (!$isListNode(trailingList) || trailingList.getPreviousSibling() !== paragraph) return;
  if (orderedStart !== null && trailingList.getListType() === "number") {
    trailingList.setStart(orderedStart);
  }
  const first = trailingList.getFirstChild();
  if (!$isListItemNode(first)) return;
  const children = first.getChildren();
  const orphanedSublist = children.length === 1 ? children[0] : null;
  if (!$isListNode(orphanedSublist)) return;
  for (const promoted of orphanedSublist.getChildren()) first.insertBefore(promoted);
  first.remove();
}
