import { type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronDown } from "@/components/ui/icons";

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
  return (
    <div className="relative overflow-clip rounded-t-2xl border-x border-t border-border/70 bg-card/70 backdrop-blur-sm transition-colors">
      {header && (
        <div className="flex w-full items-center justify-between gap-1.5 py-1.5 pr-2 pl-3 text-sm">
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
