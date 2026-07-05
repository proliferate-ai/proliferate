import { GitFork } from "lucide-react";
import {
  subagentDisplayTitle,
  subagentStatusLabel,
  subagentStatusTone,
  subagentUsageDurationLabel,
  type ActivitySubagentWire,
  type SubagentTone,
} from "@proliferate/product-domain/activity/subagent";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

const TONE_CLASSNAME: Record<SubagentTone, string> = {
  default: "text-muted-foreground",
  positive: "text-success",
  danger: "text-destructive",
};

export interface SubagentRosterRowProps {
  subagent: ActivitySubagentWire;
  nowMs: number;
  /** Optional per-row click-in, e.g. to open the existing delegated-work details surface. */
  onOpen?: (subagentId: string) => void;
}

/**
 * A read-only roster row for a harness-native subagent (Claude Task agent,
 * Codex collab child thread, Cursor `cursor/task`). Per
 * `codex/session-activity-architecture.md` this roster feeds a new
 * delegated-work *source* (see `activitySubagentToDelegatedWorkFields` in
 * product-domain) — this row is the interim standalone rendering until a
 * follow-up pass merges it into the existing delegated-work surfaces
 * (`features/delegated-work.md`), which own generated identity/color.
 */
export function SubagentRosterRow({ subagent, nowMs, onOpen }: SubagentRosterRowProps) {
  const tone = subagentStatusTone(subagent);
  const durationLabel = subagentUsageDurationLabel(subagent.usage, nowMs);
  const displayTitle = subagentDisplayTitle(subagent);
  const content = (
    <>
      <GitFork className={twMerge("mt-0.5 size-3.5 shrink-0", TONE_CLASSNAME[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground" data-telemetry-mask title={displayTitle}>
          {displayTitle}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className={TONE_CLASSNAME[tone]}>{subagentStatusLabel(subagent)}</span>
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
        </div>
        {subagent.status.status === "completed" && subagent.status.summary && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" data-telemetry-mask>
            {subagent.status.summary}
          </p>
        )}
      </div>
    </>
  );

  if (!onOpen) {
    return (
      <div
        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left"
        data-subagent-roster-row
        data-subagent-id={subagent.id}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/40"
      onClick={() => onOpen(subagent.id)}
      data-subagent-roster-row
      data-subagent-id={subagent.id}
    >
      {content}
    </button>
  );
}
