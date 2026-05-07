import { type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { MoreHorizontal, Pause, Pencil, Play, Zap } from "@/components/ui/icons";
import type { AutomationResponse } from "@/lib/access/cloud/client";
import { buildAutomationRowViewModel } from "@/lib/domain/automations/view-model";

interface AutomationRowProps {
  automation: AutomationResponse;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunNow: () => void;
}

export function AutomationRow({
  automation,
  selected,
  busy,
  onSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationRowProps) {
  const view = buildAutomationRowViewModel(automation);
  const enabled = automation.enabled;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onSelect();
  };

  return (
    <div role="listitem">
      <div
        onClick={onSelect}
        className={`group cursor-pointer rounded-lg px-3 py-3 transition-colors ${
          selected ? "bg-accent/70" : "hover:bg-accent/45"
        }`}
      >
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={view.title}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate text-base leading-6 text-foreground">
                {view.title}
              </span>
              {!enabled && (
                <span className="shrink-0 text-sm text-muted-foreground">Paused</span>
              )}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{view.repoLabel}</span>
              <span aria-hidden="true">-</span>
              <span className="truncate">Next {view.nextRunPlainLabel}</span>
            </div>
          </div>

          <div className="flex min-h-7 shrink-0 items-center gap-1.5">
            <span className="max-w-48 truncate text-right text-sm text-muted-foreground">
              {view.scheduleLabel}
            </span>
            <PopoverButton
              stopPropagation
              trigger={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label="Automation actions"
                  className="text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=open]:bg-transparent"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
              side="bottom"
              align="end"
              className="w-44 rounded-xl border border-border bg-popover p-1 shadow-floating"
            >
              {(close) => (
                <>
                  <PopoverMenuItem
                    icon={<Zap className="size-4" />}
                    label="Run now"
                    disabled={busy || !enabled}
                    onClick={() => {
                      close();
                      onRunNow();
                    }}
                  />
                  <PopoverMenuItem
                    icon={<Pencil className="size-4" />}
                    label="Edit"
                    disabled={busy}
                    onClick={() => {
                      close();
                      onEdit();
                    }}
                  />
                  <PopoverMenuItem
                    icon={enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
                    label={enabled ? "Pause" : "Resume"}
                    disabled={busy}
                    onClick={() => {
                      close();
                      if (enabled) {
                        onPause();
                      } else {
                        onResume();
                      }
                    }}
                  />
                </>
              )}
            </PopoverButton>
          </div>
        </div>
      </div>
    </div>
  );
}
