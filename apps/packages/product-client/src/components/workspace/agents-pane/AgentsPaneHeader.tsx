import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { ChevronRight } from "#product/primitives/icons/core";

/**
 * The pane's one header: back arrow (only where there is somewhere to go back
 * to), title, live summary. Agents Pane canvas page.
 */
export function AgentsPaneHeader({
  title,
  summary,
  onBack,
  glyph,
  actions,
}: {
  title: string;
  summary: string | null;
  onBack?: (() => void) | null;
  glyph?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-border-light px-3 py-3"
      data-agents-pane-header
    >
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="unstyled"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
          aria-label="Back to all agents"
          onClick={onBack}
        >
          <ChevronRight className="icon-paired rotate-180" />
        </Button>
      )}
      {glyph}
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-ui font-medium">{title}</p>
        {summary && (
          <p className="m-0 truncate text-ui-sm text-sidebar-muted-foreground">{summary}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
