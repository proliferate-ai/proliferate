import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { $createTextNode, type LexicalEditor } from "lexical";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { useChatFileMentionMenu } from "#product/hooks/chat/ui/use-chat-file-mention-menu";
import { useChatSlashCommandMenu } from "#product/hooks/chat/ui/use-chat-slash-command-menu";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import {
  findComposerMenuTrigger,
  type ComposerMenuTrigger,
} from "#product/lib/domain/chat/composer/composer-menu-trigger";
import type { ChatMentionMenuItem } from "#product/lib/domain/chat/composer/chat-mention-items";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordTypingKeystrokeLatency,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { markTypingActivity } from "#product/lib/infra/interaction/typing-activity-store";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { ComposerFileMentionSearch } from "#product/components/workspace/chat/input/ComposerFileMentionSearch";
import { ComposerSlashCommandSearch } from "#product/components/workspace/chat/input/ComposerSlashCommandSearch";
import { $createComposerFileMentionNode } from "#product/components/workspace/chat/input/ComposerFileMentionNode";
import { $createComposerContextDocMentionNode } from "#product/components/workspace/chat/input/ComposerContextDocMentionNode";
import { ComposerRichTextEditor } from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import {
  getComposerEditorContext,
  replaceComposerRangeWithNodes,
  replaceComposerTextRange,
  type ComposerEditorContext,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";
import { ComposerTextareaFrame, type ComposerTextareaFrameTopInset } from "#product/primitives/patterns/composer/ComposerTextareaFrame";

interface ComposerCommandEditorProps {
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  placeholder: string;
  canSubmit: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onKeyDown?: (event: ChatComposerKeyboardEvent) => void;
  topInset: ComposerTextareaFrameTopInset;
  overlayHostElement?: HTMLElement | null;
}

const TYPING_SURFACES = [
  "chat-composer", "chat-composer-dock", "chat-composer-dock-region",
  "chat-composer-dock-slots", "chat-composer-dock-input",
  "chat-composer-dock-footer", "chat-surface", "transcript-list",
  "header-tabs", "workspace-sidebar",
];

export function ComposerCommandEditor({
  draft,
  onDraftChange,
  placeholder,
  canSubmit,
  disabled,
  onSubmit,
  onKeyDown,
  topInset,
  overlayHostElement,
}: ComposerCommandEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const commandTriggerRef = useRef<ComposerMenuTrigger | null>(null);
  const markdown = serializeChatDraftToPrompt(draft);
  const [editorContext, setEditorContext] = useState<ComposerEditorContext>({
    plainText: markdown,
    anchorOffset: markdown.length,
    focusOffset: markdown.length,
    selectionInCodeBlock: false,
  });
  const plainText = editorContext.plainText;
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => (
    searchSuppressed || disabled || editorContext.selectionInCodeBlock
      ? null
      : findComposerMenuTrigger(plainText, editorContext.focusOffset)
  ), [
    disabled,
    editorContext.focusOffset,
    editorContext.selectionInCodeBlock,
    plainText,
    searchSuppressed,
  ]);
  commandTriggerRef.current = trigger;
  const slashTrigger = trigger?.kind === "slash" ? trigger : null;
  const mentionTrigger = trigger?.kind === "mention" ? trigger : null;

  const handleChange = useCallback((
    value: string,
    eventTimeStampMs: number | undefined,
    snapshot: ChatComposerDraft["editorSnapshot"],
  ) => {
    markTypingActivity();
    const operationId = startMeasurementOperation({
      kind: "composer_typing",
      sampleKey: "composer",
      surfaces: TYPING_SURFACES,
      idleTimeoutMs: 1500,
      maxDurationMs: 8000,
      cooldownMs: 2000,
    });
    if (operationId) {
      typingOperationRef.current = operationId;
      markOperationForNextCommit(operationId, TYPING_SURFACES);
    }
    recordTypingKeystrokeLatency({
      operationId,
      surface: "chat-composer",
      eventTimeStampMs,
    });
    onDraftChange(createTextDraft(value, snapshot));
    setSearchSuppressed(false);
  }, [onDraftChange]);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  // The token the trigger opened is replaced whole, and any single space that
  // already followed it is absorbed so completing a trigger never leaves a
  // double space behind.
  const replaceEndFor = useCallback((activeTrigger: ComposerMenuTrigger) => (
    plainText[activeTrigger.end] === " "
      ? activeTrigger.end + 1
      : activeTrigger.end
  ), [plainText]);

  const handleSelectSearchResult = useCallback((command: SessionSlashCommandViewModel) => {
    const activeTrigger = commandTriggerRef.current;
    if (activeTrigger?.kind !== "slash" || !editorRef.current) return;
    replaceComposerTextRange(
      editorRef.current,
      activeTrigger.start,
      replaceEndFor(activeTrigger),
      `${command.displayName} `,
    );
    setSearchSuppressed(true);
    editorRef.current.focus();
  }, [replaceEndFor]);

  const handleSelectMention = useCallback((item: ChatMentionMenuItem) => {
    const activeTrigger = commandTriggerRef.current;
    if (activeTrigger?.kind !== "mention" || !editorRef.current) return;
    // The mention is inserted as a chip node plus a trailing space, not as
    // markdown text: markdown typed in one shot never reaches the shortcut
    // plugin, so building the node here is what makes the draft show a chip
    // immediately. Serialization back to the mention token is the node's job.
    replaceComposerRangeWithNodes(
      editorRef.current,
      activeTrigger.start,
      replaceEndFor(activeTrigger),
      () => [
        item.kind === "contextDoc"
          ? $createComposerContextDocMentionNode(
              { runId: item.doc.runId, filename: item.doc.filename },
              item.doc.filename,
            )
          : $createComposerFileMentionNode(item.file.path, item.file.name),
        $createTextNode(" "),
      ],
    );
    setSearchSuppressed(true);
    editorRef.current.focus();
  }, [replaceEndFor]);

  const search = useChatSlashCommandMenu({
    open: !!slashTrigger,
    query: slashTrigger?.query ?? "",
    onSelect: handleSelectSearchResult,
  });
  const mentions = useChatFileMentionMenu({
    open: !!mentionTrigger,
    query: mentionTrigger?.query ?? "",
    onSelect: handleSelectMention,
  });
  const openMenu = slashTrigger ? search : mentionTrigger ? mentions : null;
  const openMenuItemCount = slashTrigger
    ? search.commands.length
    : mentionTrigger
      ? mentions.items.length
      : 0;

  const handleKeyDown = useCallback((event: ChatComposerKeyboardEvent) => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.defaultPrevented) return;
    if (openMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu.moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSearchSuppressed(true);
        return;
      }
    }
    onKeyDown?.(event);
  }, [onKeyDown, openMenu]);

  const handleCommandKey = useCallback((event: KeyboardEvent) => {
    if (!editorRef.current || event.defaultPrevented || event.isComposing) return false;
    const context = getComposerEditorContext(editorRef.current);
    const activeTrigger = searchSuppressed || disabled || context.selectionInCodeBlock
      ? null
      : findComposerMenuTrigger(context.plainText, context.focusOffset);
    commandTriggerRef.current = activeTrigger;
    // The trigger is recomputed fresh from the DOM here, since the keydown can
    // land before React re-renders; require it to still match the kind of
    // menu that's actually open (from the last render) rather than reasoning
    // about the two triggers' presence indirectly.
    if (!activeTrigger || !openMenu || activeTrigger.kind !== trigger?.kind) {
      return false;
    }
    if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && openMenuItemCount > 0) {
      event.preventDefault();
      openMenu.selectHighlighted();
      return true;
    }
    return false;
  }, [disabled, openMenu, openMenuItemCount, searchSuppressed, trigger]);

  const searchTray = slashTrigger ? (
    <ComposerSlashCommandSearch
      commands={search.commands}
      highlightedIndex={search.highlightedIndex}
      listRef={search.listRef}
      onSelect={handleSelectSearchResult}
      onRowMouseEnter={search.handleRowMouseEnter}
      setRowRef={search.setRowRef}
      getRowId={search.getRowId}
    />
  ) : mentionTrigger ? (
    <ComposerFileMentionSearch
      items={mentions.items}
      highlightedIndex={mentions.highlightedIndex}
      listRef={mentions.listRef}
      query={mentionTrigger.query}
      isLoading={mentions.isLoading}
      isError={mentions.isError}
      isPending={mentions.isPending}
      runtimeReady={mentions.runtimeReady}
      onSelect={handleSelectMention}
      onRowMouseEnter={mentions.handleRowMouseEnter}
      setRowRef={mentions.setRowRef}
      getRowId={mentions.getRowId}
    />
  ) : null;
  // Focus deliberately stays in the composer's contenteditable while a menu is
  // open (a menu row must never steal it, see the row's onMouseDown), so the
  // highlighted row is announced via aria-activedescendant on the editable
  // rather than by moving native focus onto the row.
  const activeDescendantId = slashTrigger
    ? search.activeDescendantId
    : mentionTrigger
      ? mentions.activeDescendantId
      : undefined;

  return (
    <>
      {searchTray && overlayHostElement ? createPortal(searchTray, overlayHostElement) : searchTray}
      <ComposerTextareaFrame topInset={topInset}>
        <div
          className="relative overflow-y-auto"
          style={{
            minHeight: `${WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
            // Capped at 25dvh so the draft area never crowds out the
            // transcript above it on short viewports, even when maxRows
            // would otherwise let it grow taller.
            maxHeight: `min(calc(var(--text-composer--line-height) * ${WORKSPACE_CHAT_COMPOSER_INPUT.maxRows}), 25dvh)`,
          }}
        >
          <ComposerRichTextEditor
            value={markdown}
            snapshot={draft.editorSnapshot}
            onChange={handleChange}
            onEditorContextChange={setEditorContext}
            onKeyDown={handleKeyDown}
            onCommandKey={handleCommandKey}
            activeDescendantId={activeDescendantId}
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            editorRef={(editor) => { editorRef.current = editor; }}
            placeholder={placeholder}
            disabled={disabled}
          />
        </div>
      </ComposerTextareaFrame>
    </>
  );
}
