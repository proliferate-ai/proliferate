import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { LexicalEditor } from "lexical";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { useChatSlashCommandMenu } from "#product/hooks/chat/ui/use-chat-slash-command-menu";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import {
  findSlashCommandTrigger,
  type SlashCommandTrigger,
} from "#product/lib/domain/chat/composer/slash-command-draft-edits";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordTypingKeystrokeLatency,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { markTypingActivity } from "#product/lib/infra/interaction/typing-activity-store";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { ComposerSlashCommandSearch } from "#product/components/workspace/chat/input/ComposerSlashCommandSearch";
import {
  ComposerRichTextEditor,
  getComposerEditorContext,
  replaceComposerTextRange,
  type ComposerEditorContext,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";
import { ComposerTextareaFrame, type ComposerTextareaFrameTopInset } from "@proliferate/ui/primitives/ComposerTextareaFrame";

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
  const commandTriggerRef = useRef<SlashCommandTrigger | null>(null);
  const markdown = serializeChatDraftToPrompt(draft);
  const [editorContext, setEditorContext] = useState<ComposerEditorContext>({
    plainText: markdown,
    anchorOffset: markdown.length,
    focusOffset: markdown.length,
  });
  const plainText = editorContext.plainText;
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => (
    searchSuppressed || disabled
      ? null
      : findSlashCommandTrigger(plainText, editorContext.focusOffset)
  ), [disabled, editorContext.focusOffset, plainText, searchSuppressed]);
  commandTriggerRef.current = trigger;

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

  const handleSelectSearchResult = useCallback((command: SessionSlashCommandViewModel) => {
    const activeTrigger = commandTriggerRef.current;
    if (!activeTrigger || !editorRef.current) return;
    const replacement = `${command.displayName} `;
    const replaceEnd = /\s/u.test(plainText[activeTrigger.end] ?? "")
      ? activeTrigger.end + 1
      : activeTrigger.end;
    replaceComposerTextRange(editorRef.current, activeTrigger.start, replaceEnd, replacement);
    setSearchSuppressed(true);
    editorRef.current.focus();
  }, [plainText]);

  const search = useChatSlashCommandMenu({
    open: !!trigger,
    query: trigger?.query ?? "",
    onSelect: handleSelectSearchResult,
  });

  const handleKeyDown = useCallback((event: ChatComposerKeyboardEvent) => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.defaultPrevented) return;
    if (trigger) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        search.moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSearchSuppressed(true);
        return;
      }
    }
    onKeyDown?.(event);
  }, [onKeyDown, search, trigger]);

  const handleCommandKey = useCallback((event: KeyboardEvent) => {
    if (!editorRef.current || event.defaultPrevented || event.isComposing) return false;
    const context = getComposerEditorContext(editorRef.current);
    const activeTrigger = searchSuppressed || disabled
      ? null
      : findSlashCommandTrigger(context.plainText, context.focusOffset);
    commandTriggerRef.current = activeTrigger;
    if (!activeTrigger) return false;
    if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && search.commands.length > 0) {
      event.preventDefault();
      search.selectHighlighted();
      return true;
    }
    return false;
  }, [disabled, search, searchSuppressed]);

  const searchTray = trigger ? (
    <ComposerSlashCommandSearch
      commands={search.commands}
      highlightedIndex={search.highlightedIndex}
      listRef={search.listRef}
      onSelect={handleSelectSearchResult}
      onRowMouseEnter={search.handleRowMouseEnter}
      setRowRef={search.setRowRef}
    />
  ) : null;

  return (
    <>
      {searchTray && overlayHostElement ? createPortal(searchTray, overlayHostElement) : searchTray}
      <ComposerTextareaFrame topInset={topInset}>
        <div
          className="relative overflow-y-auto"
          style={{
            minHeight: `${WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
            maxHeight: `calc(var(--text-composer--line-height) * ${WORKSPACE_CHAT_COMPOSER_INPUT.maxRows})`,
          }}
        >
          <ComposerRichTextEditor
            value={markdown}
            snapshot={draft.editorSnapshot}
            onChange={handleChange}
            onEditorContextChange={setEditorContext}
            onKeyDown={handleKeyDown}
            onCommandKey={handleCommandKey}
            submitBehavior="workspace"
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
