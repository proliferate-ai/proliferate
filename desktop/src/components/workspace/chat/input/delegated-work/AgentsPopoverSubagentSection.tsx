import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import { PopoverSection } from "./PopoverSection";

export function AgentsPopoverSubagentSection({
  subagents,
  detail,
  showTitle = true,
  onClose,
}: {
  subagents: NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
  detail?: string | null;
  showTitle?: boolean;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Subagents" detail={detail} showTitle={showTitle}>
      {subagents.parent && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-0.5 flex h-7 w-full justify-between gap-2 rounded-md px-1.5 py-0 text-left hover:bg-muted/40"
          onClick={() => {
            subagents.openParent(subagents.parent!.parentSessionId);
            onClose();
          }}
        >
          <span className="truncate text-sm font-medium text-foreground">Parent agent</span>
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </Button>
      )}
      <div className="space-y-0.5">
        {subagents.rows.map((row) => (
          <div
            key={row.sessionLinkId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted/40"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full min-w-0 justify-between rounded-md px-1.5 py-0 text-left hover:bg-transparent"
              onClick={() => {
                subagents.openSubagent(row.childSessionId);
                onClose();
              }}
            >
              <span className="min-w-0 truncate text-sm text-foreground">
                {row.label}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {row.wakeScheduled ? "Wake" : row.statusLabel}
              </span>
            </Button>
            {!row.wakeScheduled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
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
