import {
  subagentDisplayTitle,
  subagentStatusLabel,
  subagentStatusTone,
  subagentUsageDurationLabel,
  type ActivitySubagentWire,
  type SubagentTone,
} from "#product/domain/activity/subagent";
import { statusDotToneTextClass, type StatusDotTone } from "#product/primitives/StatusDot";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

const SUBAGENT_STATUS_DOT_TONE: Record<SubagentTone, StatusDotTone> = {
  default: "muted",
  positive: "success",
  danger: "danger",
};

export interface SubagentRosterRowProps {
  subagent: ActivitySubagentWire;
  nowMs: number;
  workspaceId: string;
  /** Optional per-row click-in, e.g. to open the existing delegated-work details surface. */
  onOpen?: (subagentId: string) => void;
}

/**
 * A read-only roster row for a harness-native subagent (Claude Task agent,
 * Codex collab child thread, Cursor `cursor/task`). This roster feeds a new
 * delegated-work *source* (see `activitySubagentToDelegatedWorkFields` in
 * the shared domain layer).
 *
 * The row's glyph is generated via `buildDelegatedAgentIdentity` from the
 * roster's own durable id (`ActivitySubagentWire.id` — Claude's Task
 * `agentId`, Codex's collab thread id) so this chip, the detail view's
 * header, and any other surface referencing the same subagent all agree on
 * one generated name/color/glyph (Design Handoff — native subagent identity;
 * Delivery Spec — Background Work Slice 1, rung R4).
 */
export function SubagentRosterRow({ subagent, nowMs, workspaceId, onOpen }: SubagentRosterRowProps) {
  const tone = SUBAGENT_STATUS_DOT_TONE[subagentStatusTone(subagent)];
  const durationLabel = subagentUsageDurationLabel(subagent.usage, nowMs);
  const displayTitle = subagentDisplayTitle(subagent);
  const identity = buildDelegatedAgentIdentity({
    id: subagent.id,
    title: displayTitle,
    workspaceId,
    sessionId: subagent.id,
  });

  return (
    <RosterRow
      leading={<AgentIdentityGlyph identity={identity} dimension={16} />}
      title={<span data-telemetry-mask title={displayTitle}>{displayTitle}</span>}
      secondary={(
        <>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className={statusDotToneTextClass(tone)}>{subagentStatusLabel(subagent)}</span>
            {subagent.model && (
              <>
                <span aria-hidden>·</span>
                <span>{subagent.model}</span>
              </>
            )}
            {subagent.background && (
              <>
                <span aria-hidden>·</span>
                <span>background</span>
              </>
            )}
            {durationLabel && (
              <>
                <span aria-hidden>·</span>
                <span>{durationLabel}</span>
              </>
            )}
          </span>
          {subagent.status.status === "completed" && subagent.status.summary && (
            <span className="mt-0.5 block truncate" data-telemetry-mask>
              {subagent.status.summary}
            </span>
          )}
        </>
      )}
      onSelect={onOpen ? () => onOpen(subagent.id) : undefined}
      data-subagent-roster-row=""
      data-subagent-id={subagent.id}
    />
  );
}
