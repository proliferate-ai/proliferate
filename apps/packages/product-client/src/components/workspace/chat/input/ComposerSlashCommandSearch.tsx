import type { RefObject } from "react";
import {
  ComposerInlineMenuGroupLabel,
  ComposerInlineMenuPanel,
  ComposerInlineMenuRow,
  ComposerInlineMenuStatusRow,
} from "#product/components/workspace/chat/input/ComposerInlineMenu";
import type {
  SessionSlashCommandGroup,
  SessionSlashCommandViewModel,
} from "#product/lib/domain/chat/composer/session-slash-command-policy";

interface ComposerSlashCommandSearchProps {
  commands: readonly SessionSlashCommandViewModel[];
  highlightedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (command: SessionSlashCommandViewModel) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  getRowId: (index: number) => string;
  className?: string;
}

export function ComposerSlashCommandSearch({
  commands,
  highlightedIndex,
  listRef,
  onSelect,
  onRowMouseEnter,
  setRowRef,
  getRowId,
  className,
}: ComposerSlashCommandSearchProps) {
  return (
    <ComposerInlineMenuPanel listRef={listRef} label="Slash commands" className={className}>
      {commands.length > 0 ? (
        commands.map((command, index) => (
          <SlashCommandRow
            key={command.id}
            command={command}
            index={index}
            id={getRowId(index)}
            selected={index === highlightedIndex}
            showGroupLabel={shouldShowGroupLabel(commands, index)}
            onSelect={onSelect}
            onRowMouseEnter={onRowMouseEnter}
            setRowRef={setRowRef}
          />
        ))
      ) : (
        <ComposerInlineMenuStatusRow>No matching slash commands.</ComposerInlineMenuStatusRow>
      )}
    </ComposerInlineMenuPanel>
  );
}

function SlashCommandRow({
  command,
  index,
  id,
  selected,
  showGroupLabel,
  onSelect,
  onRowMouseEnter,
  setRowRef,
}: {
  command: SessionSlashCommandViewModel;
  index: number;
  id: string;
  selected: boolean;
  showGroupLabel: boolean;
  onSelect: (command: SessionSlashCommandViewModel) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
}) {
  // Typographic ranking, three steps in one row: the command name carries the
  // control weight at reading size, the description drops a size step into the
  // muted role, and the argument hint trails at the same muted step. Nothing
  // needs a bold — at 11-12px the weight token plus color does the whole
  // hierarchy.
  const commandName = command.displayName.startsWith("/")
    ? command.displayName.slice(1)
    : command.displayName;
  const detail = command.description || command.inputHint;
  // Rows truncate; the native title carries the full text on hover.
  const fullText = [command.displayName, command.description, command.inputHint]
    .filter(Boolean)
    .join(" — ");

  return (
    <>
      {showGroupLabel ? (
        <>
          <div data-slash-command-group-label-marker="" />
          <ComposerInlineMenuGroupLabel>{command.group}</ComposerInlineMenuGroupLabel>
        </>
      ) : null}
      <ComposerInlineMenuRow
        id={id}
        index={index}
        selected={selected}
        title={fullText}
        // The leading slash is its own muted glyph so the row reads as
        // "name, after a slash" rather than one undifferentiated token.
        leading={<span className="shrink-0 font-control text-muted-foreground">/</span>}
        primary={<span className="font-control">{commandName}</span>}
        secondary={detail}
        trailing={command.inputHint && command.description ? command.inputHint : undefined}
        onSelect={() => onSelect(command)}
        onRowMouseEnter={onRowMouseEnter}
        setRowRef={setRowRef}
      />
    </>
  );
}

function shouldShowGroupLabel(
  commands: readonly SessionSlashCommandViewModel[],
  index: number,
): boolean {
  const group = commands[index]?.group;
  if (!group || group === "Commands") {
    return false;
  }
  const previousGroup: SessionSlashCommandGroup | undefined = commands[index - 1]?.group;
  return previousGroup !== group;
}
