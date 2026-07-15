import { Button } from "@proliferate/ui/primitives/Button";
import type { NavigationCloseChildAgent } from "@/lib/domain/playground/subagents-ux/navigation-close-model";
import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";

export function NavigationClosePaneRow({
  child,
  isFocused,
  statusLine,
  onOpen,
  action,
  dimmed = false,
}: {
  child: NavigationCloseChildAgent;
  isFocused: boolean;
  statusLine: string;
  onOpen: () => void;
  action?: { label: string; onClick: () => void; title?: string };
  dimmed?: boolean;
}) {
  return (
    <div
      className={`group/pane-row flex min-h-11 items-center rounded-lg hover:bg-sidebar-accent ${isFocused ? "bg-sidebar-accent" : ""}`}
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-current={isFocused ? "true" : undefined}
        title={child.title}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-start gap-2 px-2 py-1.5 text-left text-sidebar-foreground"
      >
        <SubagentIdentityGlyph
          seed={child.id}
          size={18}
          dimmed={dimmed}
          label={`Identity mark for ${child.title}`}
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-ui font-medium ${dimmed ? "text-sidebar-muted-foreground" : ""}`}>
            {child.title}
          </span>
          <span className="block truncate text-ui-sm font-normal text-sidebar-muted-foreground">
            {statusLine}
          </span>
        </span>
      </Button>
      {action ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${action.label} ${child.title}`}
          title={action.title}
          onClick={action.onClick}
          className="mr-1 h-7 shrink-0 px-2 text-sidebar-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-destructive group-hover/pane-row:opacity-100 focus-visible:opacity-100"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
