import { Button } from "@proliferate/ui/primitives/Button";
import { ExternalLink } from "@proliferate/ui/icons";
import { DelegatedAgentIdenticon } from "@/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type {
  DelegatedWorkComposerViewModel,
} from "@/hooks/chat/facade/use-delegated-work-composer";
import { PopoverSection } from "./PopoverSection";

type SubagentRows = NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
type SubagentRow = SubagentRows["rows"][number];

export function AgentsPopoverSubagentSection({
  subagents,
  detail,
  onClose,
}: {
  subagents: NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
  detail?: string | null;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Subagents" detail={detail}>
      {subagents.parent && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 flex h-auto w-full justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/40"
          onClick={() => {
            subagents.openParent(subagents.parent!.parentSessionId);
            onClose();
          }}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">Parent agent</span>
            <span className="block truncate text-xs text-muted-foreground">
              {subagents.parent.label}
            </span>
          </span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      )}
      <div className="space-y-0.5">
        {subagents.rows.map((row) => (
          <SubagentPopoverRow
            key={row.sessionLinkId}
            row={row}
            isSchedulingWake={subagents.isSchedulingWake}
            onOpen={() => {
              subagents.openSubagent(row.childSessionId);
              onClose();
            }}
            onScheduleWake={() => subagents.scheduleWake(row.childSessionId)}
          />
        ))}
      </div>
    </PopoverSection>
  );
}

function SubagentPopoverRow({
  row,
  isSchedulingWake,
  onOpen,
  onScheduleWake,
}: {
  row: SubagentRow;
  isSchedulingWake: boolean;
  onOpen: () => void;
  onScheduleWake: () => void;
}) {
  const secondaryLabel = row.wakeScheduled
    ? "Wake scheduled"
    : row.latestCompletionLabel ?? row.statusLabel;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full min-w-0 justify-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-transparent"
        onClick={onOpen}
      >
        <DelegatedAgentIdenticon
          identity={row.identity}
          className={`size-3.5 shrink-0 ${row.identity.textColorClassName}`}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {row.identity.displayName}
          </span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {secondaryLabel}
          </span>
        </span>
      </Button>
      {!row.wakeScheduled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          loading={isSchedulingWake}
          aria-label={`Schedule wake for ${row.identity.displayName}`}
          onClick={onScheduleWake}
        >
          Wake
        </Button>
      )}
    </div>
  );
}
