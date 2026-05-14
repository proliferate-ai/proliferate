import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import type {
  HeaderDelegatedWorkIndicator,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

export function ChatTabDelegatedIndicators({
  indicators,
  onOpenSession,
}: {
  indicators: readonly HeaderDelegatedWorkIndicator[];
  onOpenSession?: (indicator: HeaderDelegatedWorkIndicator) => void;
}) {
  if (indicators.length === 0) {
    return null;
  }

  const stack = <DelegatedIndicatorStack indicators={indicators} />;
  if (!onOpenSession) {
    return stack;
  }

  return (
    <PopoverButton
      align="end"
      side="bottom"
      offset={6}
      stopPropagation
      className="w-64 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-tab-drag-ignore="true"
          aria-label="Open delegated agents"
          title="Open delegated agents"
          className="flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {stack}
        </Button>
      )}
    >
      {(close) => (
        <div data-telemetry-mask="true" className="max-h-72 overflow-y-auto">
          {indicators.map((indicator) => (
            <PopoverMenuItem
              key={indicator.id}
              label={indicator.title}
              icon={(
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[10px] font-medium leading-none text-white ${indicator.colorClassName}`}
                >
                  {indicator.initial}
                </span>
              )}
              trailing={renderDelegatedIndicatorTrailing(indicator)}
              onClick={() => {
                close();
                onOpenSession(indicator);
              }}
            >
              <span className="block truncate text-xs text-muted-foreground">
                {indicator.avatarName}
              </span>
            </PopoverMenuItem>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

function DelegatedIndicatorStack({
  indicators,
}: {
  indicators: readonly HeaderDelegatedWorkIndicator[];
}) {
  const visible = indicators.slice(0, 3);
  const overflow = indicators.length - visible.length;
  return (
    <span className="ml-1 flex shrink-0 items-center">
      {visible.map((indicator, index) => (
        <span
          key={indicator.id}
          title={`${indicator.avatarName}\n${indicator.title}\n${indicator.statusLabel}`}
          className={`flex size-4 items-center justify-center rounded-full border border-card text-[9px] font-medium leading-none text-white shadow-sm ${indicator.colorClassName} ${
            index > 0 ? "-ml-1.5" : ""
          }`}
        >
          {indicator.initial}
        </span>
      ))}
      {overflow > 0 && (
        <span className="-ml-1.5 rounded-full border border-card bg-muted px-1 text-[9px] font-medium leading-4 text-muted-foreground">
          +{overflow}
        </span>
      )}
    </span>
  );
}

function renderDelegatedIndicatorTrailing(
  indicator: HeaderDelegatedWorkIndicator,
): ReactNode {
  if (indicator.statusLabel === "Failed") {
    return <span className="text-xs text-destructive">Failed</span>;
  }
  if (indicator.statusLabel === "Working") {
    return <span className="text-xs text-foreground">Working</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {indicator.statusLabel}
    </span>
  );
}
