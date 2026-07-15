import type { RefObject } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
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
        "mb-2 overflow-hidden rounded-2xl border border-border bg-popover/90 p-1 text-popover-foreground shadow-popover backdrop-blur-sm",
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
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
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
  // Rows truncate aggressively; the hover tooltip carries the full details.
  const tooltipContent = [command.displayName, command.description, command.inputHint]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      {showGroupLabel ? (
        <>
          <div data-slash-command-group-label-marker="" />
          <div className="px-2.5 py-1 text-xs text-muted-foreground">
            {command.group}
          </div>
        </>
      ) : null}
      <Tooltip content={tooltipContent} className="flex w-full">
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
            // Color-token hover promotion, not row opacity — opacity flips
            // re-rasterize the glyphs and read as shimmer (styling.md).
            "flex w-full shrink-0 cursor-pointer items-baseline gap-2 overflow-hidden whitespace-normal rounded-lg px-2.5 py-[5px] text-left text-composer outline-none hover:bg-accent focus:bg-accent",
            selected && "bg-accent",
          )}
        >
          <span className="flex-none truncate text-popover-foreground">
            {command.displayName}
          </span>
          {detail ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {detail}
            </span>
          ) : null}
          {command.inputHint && command.description ? (
            <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
              {command.inputHint}
            </span>
          ) : null}
        </Button>
      </Tooltip>
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
