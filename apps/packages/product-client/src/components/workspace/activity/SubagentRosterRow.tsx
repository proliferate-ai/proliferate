import { Fork } from "#product/primitives/icons/core";
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
import { twMerge } from "#product/primitives/utils/tw-merge";

const SUBAGENT_STATUS_DOT_TONE: Record<SubagentTone, StatusDotTone> = {
  default: "muted",
  positive: "success",
  danger: "danger",
};

export interface SubagentRosterRowProps {
  subagent: ActivitySubagentWire;
  nowMs: number;
  /** Optional per-row click-in, e.g. to open the existing delegated-work details surface. */
  onOpen?: (subagentId: string) => void;
}

/**
 * A read-only roster row for a harness-native subagent (Claude Task agent,
 * Codex collab child thread, Cursor `cursor/task`). This roster feeds a new
 * delegated-work *source* (see `activitySubagentToDelegatedWorkFields` in
 * the shared domain layer) — this row is the interim standalone rendering until a
 * follow-up pass merges it into the existing delegated-work surfaces
 * (`features/delegated-work.md`), which own generated identity/color.
 */
export function SubagentRosterRow({ subagent, nowMs, onOpen }: SubagentRosterRowProps) {
  const tone = SUBAGENT_STATUS_DOT_TONE[subagentStatusTone(subagent)];
  const durationLabel = subagentUsageDurationLabel(subagent.usage, nowMs);
  const displayTitle = subagentDisplayTitle(subagent);

  return (
    <RosterRow
      leading={<Fork className={twMerge("icon-paired", statusDotToneTextClass(tone))} aria-hidden />}
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
