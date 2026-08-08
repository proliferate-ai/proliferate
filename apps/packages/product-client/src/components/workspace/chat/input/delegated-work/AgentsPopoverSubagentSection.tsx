import { Button } from "#product/primitives/Button";
import { ExternalLink } from "#product/primitives/icons/core";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type {
  DelegatedWorkComposerViewModel,
} from "#product/hooks/chat/facade/use-delegated-work-composer";
import { PopoverSection } from "#product/components/workspace/chat/input/delegated-work/PopoverSection";

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
            <span className="block truncate text-ui font-medium text-foreground">Parent agent</span>
            <span className="block truncate text-ui-sm text-muted-foreground">
              {subagents.parent.label}
            </span>
          </span>
          <ExternalLink className="icon-paired shrink-0 text-muted-foreground" />
        </Button>
      )}
      <div className="space-y-0.5">
        {subagents.rows.map((row) => (
          <SubagentPopoverRow
            key={row.sessionLinkId}
            row={row}
            isSchedulingWake={subagents.isSchedulingWake}
            isPromoting={subagents.isPromoting}
            onOpen={() => {
              subagents.openSubagent(row.childSessionId);
              onClose();
            }}
            onScheduleWake={() => subagents.scheduleWake(row.childSessionId)}
            onPromote={() => subagents.promote(row.childSessionId)}
          />
        ))}
      </div>
      {/* Owned peers are a SEPARATE list, never folded into the fanout above:
          a peer is nobody's subagent, and a promoted subagent has stopped being
          one. TODO(agent-ops-ux): section chrome is the design pass. */}
      {subagents.ownedAgents.length > 0 && (
        <div className="mt-1 space-y-0.5">
          <div className="flex h-7 items-center px-2">
            <span className="text-ui font-medium text-foreground">Agents</span>
          </div>
          {subagents.ownedAgents.map((row) => (
            <SubagentPopoverRow
              key={row.sessionLinkId}
              row={row}
              isSchedulingWake={subagents.isSchedulingWake}
              isPromoting={subagents.isPromoting}
              onOpen={() => {
                subagents.openOwnedAgent(row.childSessionId);
                onClose();
              }}
              onScheduleWake={() => subagents.scheduleWake(row.childSessionId)}
              onPromote={() => subagents.promote(row.childSessionId)}
            />
          ))}
        </div>
      )}
    </PopoverSection>
  );
}

function SubagentPopoverRow({
  row,
  isSchedulingWake,
  isPromoting,
  onOpen,
  onScheduleWake,
  onPromote,
}: {
  row: SubagentRow;
  isSchedulingWake: boolean;
  isPromoting: boolean;
  onOpen: () => void;
  onScheduleWake: () => void;
  onPromote: () => void;
}) {
  // A requested close outranks the other secondary lines: the agent is still
  // working, but it is working its last step.
  // TODO(agent-ops-ux): visual treatment for the closing state is the design pass.
  const secondaryLabel = row.closeRequestedLabel
    ?? (row.wakeScheduled
      ? "Wake scheduled"
      : row.latestCompletionLabel ?? row.statusLabel);

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
          <span className="block truncate text-ui font-medium text-foreground">
            {row.identity.displayName}
          </span>
          <span className="block truncate text-ui-sm font-normal text-muted-foreground">
            {secondaryLabel}
          </span>
        </span>
      </Button>
      <span className="flex items-center gap-1">
        {/* Promotion is offered only for an agent that is still subordinate:
            a peer has nothing to be promoted out of.
            TODO(agent-ops-ux): the confirm step and badge are the design pass. */}
        {row.ownership === "subagent" && !row.closeRequested && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            loading={isPromoting}
            aria-label={`Promote ${row.identity.displayName}`}
            onClick={onPromote}
          >
            Promote
          </Button>
        )}
        {/* A wake armed from here is LINK-scoped, so it is only offered where a
            delegation link exists. An owned peer has none; waking one is the
            agents' session-scoped tool, which no human route exposes. */}
        {row.ownership !== "owned_agent" && !row.wakeScheduled && (
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
      </span>
    </div>
  );
}
