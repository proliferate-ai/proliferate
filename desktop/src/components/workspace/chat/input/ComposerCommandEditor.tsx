import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { useChatSlashCommandMenu } from "@/hooks/chat/ui/use-chat-slash-command-menu";
import { useComposerTextareaAutosize } from "@/hooks/chat/ui/use-composer-textarea-autosize";
import {
  isComposerOverlaySelectKey,
  isRawComposerSubmitKey,
  isRepeatedComposerSubmitKey,
} from "@/lib/domain/chat/composer/composer-keyboard";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "@/lib/domain/chat/composer/file-mention-draft-model";
import {
  findSlashCommandTrigger,
  type SlashCommandTrigger,
} from "@/lib/domain/chat/composer/slash-command-draft-edits";
import type { SessionSlashCommandViewModel } from "@/lib/domain/chat/composer/session-slash-command-policy";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { ComposerSlashCommandSearch } from "./ComposerSlashCommandSearch";
import { ComposerTextarea } from "./ComposerTextarea";
import { ComposerTextareaFrame, type ComposerTextareaFrameTopInset } from "./ComposerTextareaFrame";

interface ComposerCommandEditorProps {
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  placeholder: string;
  canSubmit: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  topInset: ComposerTextareaFrameTopInset;
  overlayHostElement?: HTMLElement | null;
}

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const text = serializeChatDraftToPrompt(draft);
  const [selectionOffset, setSelectionOffset] = useState(text.length);
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => {
    if (searchSuppressed || disabled) {
      return null;
    }
    return findSlashCommandTrigger(text, selectionOffset);
  }, [disabled, searchSuppressed, selectionOffset, text]);

  const updateSelection = useCallback(() => {
    const next = textareaRef.current?.selectionStart ?? text.length;
    setSelectionOffset((current) => current === next ? current : next);
    setSearchSuppressed((current) => current ? false : current);
    return next;
  }, [text.length]);
  useComposerTextareaAutosize({
    textareaRef,
    value: text,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  useLayoutEffect(() => {
    const next = pendingSelectionRef.current;
    const el = textareaRef.current;
    if (next === null || !el) {
      return;
    }
    el.setSelectionRange(next, next);
    setSelectionOffset(next);
    pendingSelectionRef.current = null;
  }, [text]);

  const replaceText = useCallback((nextText: string, nextSelection: number) => {
    pendingSelectionRef.current = nextSelection;
    onDraftChange(createTextDraft(nextText));
  }, [onDraftChange]);

  const handleChange = useCallback((value: string) => {
    const operationId = startMeasurementOperation({
      kind: "composer_typing",
      sampleKey: "composer",
      surfaces: [
        "chat-composer",
        "chat-composer-dock",
        "chat-composer-dock-region",
        "chat-composer-dock-slots",
        "chat-composer-dock-input",
        "chat-composer-dock-footer",
        "chat-surface",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ],
      idleTimeoutMs: 1500,
      maxDurationMs: 8000,
      cooldownMs: 2000,
    });
    if (operationId) {
      typingOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [
        "chat-composer",
        "chat-composer-dock",
        "chat-composer-dock-region",
        "chat-composer-dock-slots",
        "chat-composer-dock-input",
        "chat-composer-dock-footer",
        "chat-surface",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ]);
    }
    onDraftChange(createTextDraft(value));
    setSearchSuppressed(false);
    window.requestAnimationFrame(() => {
      updateSelection();
    });
  }, [onDraftChange, updateSelection]);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  const handleSelectSearchResult = useCallback((command: SessionSlashCommandViewModel) => {
    if (!trigger) {
      return;
    }

    const replacement = `${command.displayName} `;
    const { start, end } = slashTriggerOffsets(trigger);
    const replaceEnd = /\s/u.test(text[end] ?? "") ? end + 1 : end;
    replaceText(
      `${text.slice(0, start)}${replacement}${text.slice(replaceEnd)}`,
      start + replacement.length,
    );
    setSearchSuppressed(true);
    textareaRef.current?.focus({ preventScroll: true });
  }, [replaceText, text, trigger]);

  const search = useChatSlashCommandMenu({
    open: !!trigger,
    query: trigger?.query ?? "",
    onSelect: handleSelectSearchResult,
  });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (trigger) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        search.moveHighlight(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        search.moveHighlight(-1);
        return;
      }
      // Empty slash results should leave Enter available for normal prompt submit.
      if (isComposerOverlaySelectKey(event) && search.commands.length > 0) {
        event.preventDefault();
        search.selectHighlighted();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSearchSuppressed(true);
        return;
      }
    }

    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (isRepeatedComposerSubmitKey(event)) {
      event.preventDefault();
      return;
    }

    if (
      isRawComposerSubmitKey(event)
    ) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }, [
    canSubmit,
    onKeyDown,
    onSubmit,
    search,
    trigger,
  ]);

  const searchTray = trigger ? (
    <ComposerSlashCommandSearch
      commands={search.commands}
      highlightedIndex={search.highlightedIndex}
      listRef={search.listRef}
      onSelect={handleSelectSearchResult}
      onRowMouseEnter={search.handleRowMouseEnter}
      setRowRef={search.setRowRef}
      className={overlayHostElement ? "mx-0" : undefined}
    />
  ) : null;

  return (
    <>
      {searchTray && overlayHostElement
        ? createPortal(searchTray, overlayHostElement)
        : searchTray}
      <ComposerTextareaFrame topInset={topInset}>
        <ComposerTextarea
          data-chat-composer-editor
          data-telemetry-mask
          ref={textareaRef}
          rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onSelect={updateSelection}
          onClick={updateSelection}
          onKeyUp={updateSelection}
          placeholder={placeholder}
          readOnly={disabled}
          aria-disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className={disabled ? "opacity-60" : ""}
        />
      </ComposerTextareaFrame>
    </>
  );
}

function slashTriggerOffsets(trigger: SlashCommandTrigger): { start: number; end: number } {
  return {
    start: trigger.start,
    end: trigger.end,
  };
}
