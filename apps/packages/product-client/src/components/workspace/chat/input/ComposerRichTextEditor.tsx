import { useEffect, useRef, type MutableRefObject, type Ref } from "react";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  type LexicalEditor,
} from "lexical";
import { $isListItemNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
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
import {
  COMPOSER_INPUT_TRANSFORMERS,
  COMPOSER_NODES,
  COMPOSER_OUTPUT_TRANSFORMERS,
  readComposerEditorContext,
  type ComposerEditorContext,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";
import { ComposerLinkPastePlugin } from "#product/components/workspace/chat/input/ComposerLinkPastePlugin";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "@proliferate/product-ui/chat/transcript/TranscriptLinkStyles";
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
  const initialConfig = {
    namespace: "ProliferateChatComposer",
    nodes: COMPOSER_NODES,
    editable: !disabled,
    theme: {
      paragraph: "m-0 min-h-[1lh]",
      text: { bold: "font-semibold", italic: "italic" },
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
      <div data-chat-composer-editor-frame className="relative min-h-[inherit]">
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
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <MarkdownShortcutPlugin transformers={INPUT_TRANSFORMERS} />
      <ComposerBehaviorPlugin
        canSubmit={canSubmit}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onCommandKey={onCommandKey}
      />
      <ComposerLinkPastePlugin markdownTransformers={OUTPUT_TRANSFORMERS} />
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
      onEditorContextChange?.(readComposerEditorContext());
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
      const inList = selectionIsInList();
      const plainEnter = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const primaryEnter = !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
      if (plainEnter && inList) return false;
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
  let node = selection.anchor.getNode();
  while (node && !$isListItemNode(node)) {
    const parent = node.getParent();
    if (!parent) return false;
    node = parent;
  }
  return $isListItemNode(node);
}

