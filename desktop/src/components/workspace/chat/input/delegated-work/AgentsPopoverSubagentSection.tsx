import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import { PopoverSection } from "./PopoverSection";

export function AgentsPopoverSubagentSection({
  subagents,
  onClose,
}: {
  subagents: NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Subagents">
      {subagents.parent && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 flex h-auto w-full justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/40"
          onClick={() => {
            subagents.openParent(subagents.parent!.parentSessionId);
            onClose();
          }}
        >
          <span className="truncate text-sm font-medium text-foreground">Parent agent</span>
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </Button>
      )}
      <div className="space-y-1">
        {subagents.rows.map((row) => (
          <div
            key={row.sessionLinkId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-2 py-2 hover:bg-muted/40"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 flex-col items-start gap-0 whitespace-normal rounded-md px-0 py-0 text-left hover:bg-transparent"
              onClick={() => {
                subagents.openSubagent(row.childSessionId);
                onClose();
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.statusLabel}
                </span>
              </span>
              {(row.latestCompletionLabel || row.wakeScheduled) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.latestCompletionLabel, row.wakeScheduled ? "Wake scheduled" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </Button>
            {!row.wakeScheduled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={subagents.isSchedulingWake}
                onClick={() => subagents.scheduleWake(row.childSessionId)}
              >
                Wake
              </Button>
            )}
          </div>
        ))}
      </div>
    </PopoverSection>
  );
}
