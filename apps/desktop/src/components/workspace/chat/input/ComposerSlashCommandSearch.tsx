import type { RefObject } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Keyboard } from "@proliferate/ui/icons";
import type {
  SessionSlashCommandGroup,
  SessionSlashCommandViewModel,
} from "@/lib/domain/chat/composer/session-slash-command-policy";

interface ComposerSlashCommandSearchProps {
  commands: readonly SessionSlashCommandViewModel[];
  highlightedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (command: SessionSlashCommandViewModel) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  className?: string;
}

export function ComposerSlashCommandSearch({
  commands,
  highlightedIndex,
  listRef,
  onSelect,
  onRowMouseEnter,
  setRowRef,
  className,
}: ComposerSlashCommandSearchProps) {
  return (
    <div
      data-composer-overlay-floating-ui
      data-telemetry-mask
      className={twMerge(
        "mb-2 overflow-hidden rounded-2xl border border-border bg-popover/95 p-1 text-sm text-popover-foreground shadow-floating backdrop-blur-sm",
        className,
      )}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          className="flex max-h-[320px] min-h-0 flex-1 flex-col overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-scrollbar-thumb) transparent" }}
        >
          {commands.length > 0 ? (
            commands.map((command, index) => (
              <SlashCommandRow
                key={command.id}
                command={command}
                index={index}
                selected={index === highlightedIndex}
                showGroupLabel={shouldShowGroupLabel(commands, index)}
                onSelect={onSelect}
                onRowMouseEnter={onRowMouseEnter}
                setRowRef={setRowRef}
              />
            ))
          ) : (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No matching slash commands.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SlashCommandRow({
  command,
  index,
  selected,
  showGroupLabel,
  onSelect,
  onRowMouseEnter,
  setRowRef,
}: {
  command: SessionSlashCommandViewModel;
  index: number;
  selected: boolean;
  showGroupLabel: boolean;
  onSelect: (command: SessionSlashCommandViewModel) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
}) {
  const detail = command.description || command.inputHint;

  return (
    <>
      {showGroupLabel ? (
        <>
          <div data-slash-command-group-label-marker="" />
          <div className="px-3 py-1 text-xs text-muted-foreground">
            {command.group}
          </div>
        </>
      ) : null}
      <Button
        ref={(element) => setRowRef(index, element)}
        type="button"
        variant="unstyled"
        size="unstyled"
        data-list-navigation-item
        aria-selected={selected}
        onMouseEnter={() => onRowMouseEnter(index)}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => onSelect(command)}
        className={twMerge(
          "flex w-full shrink-0 cursor-pointer justify-start overflow-hidden whitespace-normal rounded-lg px-3 py-2 text-left text-sm text-popover-foreground opacity-75 outline-none hover:bg-accent hover:opacity-100 focus:bg-accent",
          selected && "bg-accent opacity-100",
        )}
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <Keyboard className="size-4 shrink-0 text-muted-foreground" />
          <div className="max-w-[60%] flex-none truncate font-medium">
            {command.displayName}
          </div>
          {detail ? (
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {detail}
            </span>
          ) : null}
          {command.inputHint && command.description ? (
            <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
              {command.inputHint}
            </span>
          ) : null}
        </div>
      </Button>
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
