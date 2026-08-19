import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { $getRoot, type LexicalEditor } from "lexical";
import type { AvailableSessionCommand } from "@anyharness/sdk";
import { ComposerRichTextEditor } from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { ComposerSlashCommandSearch } from "#product/components/workspace/chat/input/ComposerSlashCommandSearch";
import {
  getComposerEditorContext,
  replaceComposerTextRange,
  type ComposerEditorContext,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";
import { useChatSlashCommandMenu } from "#product/hooks/chat/ui/use-chat-slash-command-menu";
import {
  findComposerMenuTrigger,
  type ComposerMenuTrigger,
} from "#product/lib/domain/chat/composer/composer-menu-trigger";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";

interface HomeComposerCommandEditorProps {
  value: string;
  snapshot?: ChatComposerEditorSnapshot;
  onChange: (
    markdown: string,
    eventTimeStampMs: number | undefined,
    snapshot: ChatComposerEditorSnapshot,
  ) => void;
  onKeyDown: (event: ChatComposerKeyboardEvent) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  placeholder: string;
  /** Raw per-harness catalog; the policy filter is applied by the menu hook. */
  availableCommands: readonly AvailableSessionCommand[];
  overlayHostElement: HTMLElement | null;
}

interface HomeComposerCommandEditorHandle {
  placeCaretAtEnd: () => void;
}

/**
 * The home composer's counterpart of the workspace `ComposerCommandEditor`:
 * the same slash-command menu over the same rich-text editor, fed by the
 * persisted per-harness catalog instead of a live session's ACP stream
 * (PRO-228). File mentions are deliberately absent — there is no workspace to
 * search before the launch creates one.
 */
export const HomeComposerCommandEditor = forwardRef<
  HomeComposerCommandEditorHandle,
  HomeComposerCommandEditorProps
>(function HomeComposerCommandEditor({
  value,
  snapshot,
  onChange,
  onKeyDown,
  canSubmit,
  onSubmit,
  placeholder,
  availableCommands,
  overlayHostElement,
}, ref) {
  const editorRef = useRef<LexicalEditor | null>(null);
  useImperativeHandle(ref, () => ({
    placeCaretAtEnd() {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        $getRoot().selectEnd();
      }, { discrete: true });
    },
  }), []);
  const commandTriggerRef = useRef<ComposerMenuTrigger | null>(null);
  const [editorContext, setEditorContext] = useState<ComposerEditorContext>({
    plainText: value,
    anchorOffset: value.length,
    focusOffset: value.length,
    selectionInCodeBlock: false,
  });
  const plainText = editorContext.plainText;
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => (
    searchSuppressed || editorContext.selectionInCodeBlock
      ? null
      : findComposerMenuTrigger(plainText, editorContext.focusOffset)
  ), [
    editorContext.focusOffset,
    editorContext.selectionInCodeBlock,
    plainText,
    searchSuppressed,
  ]);
  commandTriggerRef.current = trigger;
  const slashTrigger = trigger?.kind === "slash" ? trigger : null;

  const handleChange = useCallback((
    markdown: string,
    eventTimeStampMs: number | undefined,
    nextSnapshot: ChatComposerEditorSnapshot,
  ) => {
    onChange(markdown, eventTimeStampMs, nextSnapshot);
    setSearchSuppressed(false);
  }, [onChange]);

  const handleSelectSearchResult = useCallback((command: SessionSlashCommandViewModel) => {
    const activeTrigger = commandTriggerRef.current;
    if (activeTrigger?.kind !== "slash" || !editorRef.current) return;
    // The token the trigger opened is replaced whole, and any single space
    // that already followed it is absorbed so completing a trigger never
    // leaves a double space behind (same contract as ComposerCommandEditor).
    const replaceEnd = plainText[activeTrigger.end] === " "
      ? activeTrigger.end + 1
      : activeTrigger.end;
    replaceComposerTextRange(
      editorRef.current,
      activeTrigger.start,
      replaceEnd,
      `${command.displayName} `,
    );
    setSearchSuppressed(true);
    editorRef.current.focus();
  }, [plainText]);

  const search = useChatSlashCommandMenu({
    open: !!slashTrigger,
    query: slashTrigger?.query ?? "",
    onSelect: handleSelectSearchResult,
    commandsSource: availableCommands,
  });

  const handleKeyDown = useCallback((event: ChatComposerKeyboardEvent) => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.defaultPrevented) return;
    if (slashTrigger) {
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
    onKeyDown(event);
  }, [onKeyDown, search, slashTrigger]);

  const handleCommandKey = useCallback((event: KeyboardEvent) => {
    if (!editorRef.current || event.defaultPrevented || event.isComposing) return false;
    const context = getComposerEditorContext(editorRef.current);
    const activeTrigger = searchSuppressed || context.selectionInCodeBlock
      ? null
      : findComposerMenuTrigger(context.plainText, context.focusOffset);
    commandTriggerRef.current = activeTrigger;
    // The trigger is recomputed fresh from the DOM here, since the keydown can
    // land before React re-renders; require the menu that's actually open
    // (from the last render) to still match a slash trigger.
    if (activeTrigger?.kind !== "slash" || !slashTrigger) {
      return false;
    }
    if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && search.commands.length > 0) {
      event.preventDefault();
      search.selectHighlighted();
      return true;
    }
    return false;
  }, [search, searchSuppressed, slashTrigger]);

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
  ) : null;

  return (
    <>
      {searchTray && overlayHostElement ? createPortal(searchTray, overlayHostElement) : null}
      <ComposerRichTextEditor
        value={value}
        snapshot={snapshot}
        onChange={handleChange}
        onEditorContextChange={setEditorContext}
        onKeyDown={handleKeyDown}
        onCommandKey={handleCommandKey}
        activeDescendantId={slashTrigger ? search.activeDescendantId : undefined}
        canSubmit={canSubmit}
        onSubmit={onSubmit}
        editorRef={(editor) => { editorRef.current = editor; }}
        placeholder={placeholder}
        disabled={false}
        surface="home"
        className="min-h-[inherit]"
      />
    </>
  );
});
