import { Button } from "@/components/ui/Button";
import { ChevronRight } from "@/components/ui/icons";

interface TurnSeparatorProps {
  label: string;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}

/**
 * Centered separator with horizontal lines on both sides.
 * Matches Codex's "Worked for 3m 10s" / "Final message" pattern.
 */
export function TurnSeparator({
  label,
  interactive = false,
  expanded = false,
  onClick,
}: TurnSeparatorProps) {
  const content = (
    <>
      <div className="flex-1 border-t border-current/20" />
      <span className="flex items-center gap-1 whitespace-nowrap">
        <span className="text-foreground/60">{label}</span>
        {interactive && (
          <ChevronRight
            className={`size-3 text-foreground/40 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </span>
      <div className="flex-1 border-t border-current/20" />
    </>
  );

  if (interactive) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        onClick={onClick}
        className="h-auto w-full gap-2 whitespace-normal rounded-md border border-transparent bg-transparent px-0 py-1 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground hover:bg-transparent hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        {content}
      </Button>
    );
  }

  return (
    <div className="text-chat my-2 flex items-center gap-2 leading-[var(--text-chat--line-height)] text-muted-foreground">
      {content}
    </div>
  );
}
