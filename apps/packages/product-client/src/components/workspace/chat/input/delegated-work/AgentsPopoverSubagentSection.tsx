import { useState } from "react";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { ExternalLink } from "#product/primitives/icons/core";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import { AgentsPaneConfirm } from "#product/components/workspace/agents-pane/AgentsPaneConfirm";
import type {
  DelegatedWorkComposerViewModel,
} from "#product/hooks/chat/facade/use-delegated-work-composer";
import { PopoverSection } from "#product/components/workspace/chat/input/delegated-work/PopoverSection";
import {
  AGENTS_PANE_PROMOTE_CONFIRM_BODY,
  AGENTS_PANE_PROMOTED_BADGE,
  agentsPaneSectionKey,
  agentsPaneStatusLine,
} from "#product/lib/domain/delegated-work/agents-pane-model";

type SubagentRows = NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
type SubagentRow = SubagentRows["rows"][number];

export function AgentsPopoverSubagentSection({
  subagents,
  detail,
  onClose,
  onOpenPane,
}: {
  subagents: NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
  detail?: string | null;
  onClose: () => void;
  /** The "N working" cap's entry point into the pane's cluster (ADR §4). */
  onOpenPane?: () => void;
}) {
  const [promoting, setPromoting] = useState<SubagentRow | null>(null);
  const parent = subagents.parent;

  return (
    <>
      <PopoverSection title="Subagents" detail={detail}>
        {parent && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-1 flex h-auto w-full justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/40"
            onClick={() => {
              subagents.openParent(parent.parentSessionId);
              onClose();
            }}
          >
            <span className="min-w-0">
              <span className="block truncate text-ui font-medium text-foreground">Parent agent</span>
              <span className="block truncate text-ui-sm text-muted-foreground">
                {parent.label}
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
              onOpen={() => {
                subagents.openSubagent(row.childSessionId);
                onClose();
              }}
              onScheduleWake={() => subagents.scheduleWake(row.childSessionId)}
              onPromote={() => setPromoting(row)}
            />
          ))}
        </div>
      </PopoverSection>
      {/* Owned peers are a SEPARATE section, never folded into the fanout
          above: a peer is nobody's subagent, and a promoted subagent has
          stopped being one. */}
      {subagents.ownedAgents.length > 0 && (
        <PopoverSection title="Agents">
          <div className="space-y-0.5">
            {subagents.ownedAgents.map((row) => (
              <SubagentPopoverRow
                key={row.sessionLinkId}
                row={row}
                isSchedulingWake={subagents.isSchedulingWake}
                onOpen={() => {
                  subagents.openOwnedAgent(row.childSessionId);
                  onClose();
                }}
                onScheduleWake={() => subagents.scheduleWake(row.childSessionId)}
                onPromote={() => setPromoting(row)}
              />
            ))}
          </div>
        </PopoverSection>
      )}
      {onOpenPane && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full justify-start rounded-md px-2 text-ui-sm"
          onClick={() => {
            onOpenPane();
            onClose();
          }}
        >
          Open agents pane
        </Button>
      )}
      <AgentsPaneConfirm
        open={promoting !== null}
        title={promoting ? `Promote "${promoting.identity.title}"?` : ""}
        body={`${AGENTS_PANE_PROMOTE_CONFIRM_BODY}.`}
        confirmLabel="Promote"
        cancelLabel="Cancel"
        pending={subagents.isPromoting}
        onCancel={() => setPromoting(null)}
        onConfirm={() => {
          if (promoting) {
            subagents.promote(promoting.childSessionId);
          }
          setPromoting(null);
        }}
      />
    </>
  );
}

function SubagentPopoverRow({
  row,
  isSchedulingWake,
  onOpen,
  onScheduleWake,
  onPromote,
}: {
  row: SubagentRow;
  isSchedulingWake: boolean;
  onOpen: () => void;
  onScheduleWake: () => void;
  onPromote: () => void;
}) {
  // One status line, derived exactly as the pane derives it — a requested close
  // outranks the rest, because the agent is working its last step.
  const secondaryLabel = agentsPaneStatusLine(row);
  const settling = row.closeRequested || agentsPaneSectionKey(row) === "closed";

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
          className={`icon-paired shrink-0 ${
            settling ? "text-muted-foreground/50" : row.identity.textColorClassName
          }`}
        />
        <span className="min-w-0">
          <span
            className={`block truncate text-ui font-medium ${
              settling ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {row.identity.displayName}
          </span>
          <span className="block truncate text-ui-sm font-normal text-muted-foreground">
            {secondaryLabel}
          </span>
        </span>
      </Button>
      <span className="flex items-center gap-1">
        {row.ownership === "promoted" && (
          <Badge tone="neutral">{AGENTS_PANE_PROMOTED_BADGE}</Badge>
        )}
        {/* Promotion is offered only for an agent that is still subordinate:
            a peer has nothing to be promoted out of. It always asks first —
            promotion changes where the agent lives. */}
        {row.ownership === "subagent" && !row.closeRequested && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
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
