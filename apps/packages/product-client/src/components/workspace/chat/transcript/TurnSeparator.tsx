import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";

interface TurnSeparatorProps {
  label: string;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}

/** Left-aligned transcript disclosure used for nested or completed work. */
export function TurnSeparator({
  label,
  interactive = false,
  expanded = false,
  onClick,
}: TurnSeparatorProps) {
  if (interactive) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        onClick={onClick}
        className="group/turn-separator h-auto max-w-full justify-start gap-1 whitespace-normal rounded-md border border-transparent bg-transparent px-0 py-0 text-chat leading-[var(--text-chat--line-height)] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3 shrink-0 text-current transition-[transform,opacity] ${
            expanded
              ? "rotate-90 opacity-100"
              : "opacity-0 group-hover/turn-separator:opacity-100 group-focus-visible/turn-separator:opacity-100"
          }`}
        />
      </Button>
    );
  }

  return (
    <div className="text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
      {label}
    </div>
  );
}
