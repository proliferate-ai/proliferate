import { type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";

interface ComposerAttachedPanelProps {
  header?: ReactNode;
  children?: ReactNode;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function ComposerAttachedPanel({
  header,
  children,
  expanded = true,
  onToggleExpanded,
}: ComposerAttachedPanelProps) {
  // Superset attached-panel anatomy (UX_SPEC §5): 13px radius (top — the
  // bottom edge docks into the composer), 0.5px border, 2% foreground tint,
  // question header px-12 pt-12 pb-12.
  return (
    <div className="relative overflow-clip rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] backdrop-blur-sm transition-colors">
      {header && (
        <div className="flex w-full items-start justify-between gap-1.5 py-3 pr-2 pl-3 text-chat leading-[var(--text-chat--line-height)]">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {header}
          </div>
          {onToggleExpanded && (
            <div className="flex min-w-fit shrink-0 items-center gap-1.5 select-none">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleExpanded}
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                aria-label={expanded ? "Collapse panel" : "Expand panel"}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                />
              </Button>
            </div>
          )}
        </div>
      )}
      {expanded && children && (
        <div className="overflow-visible">
          {children}
        </div>
      )}
    </div>
  );
}
