import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";

interface TurnSeparatorProps {
  label: string;
  title?: string;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}

/** Disclosure label for work history, or a quiet divider before final prose. */
export function TurnSeparator({
  label,
  title,
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
        title={title}
        className="h-auto max-w-full justify-start gap-1 rounded-md border border-transparent bg-transparent p-0 text-left text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-foreground/60 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-foreground/40 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </Button>
    );
  }

  return (
    <div className="pt-1 text-foreground/60" data-chat-transcript-ignore>
      <div
        role="separator"
        aria-label={label}
        className="w-full border-t border-border"
      />
    </div>
  );
}
