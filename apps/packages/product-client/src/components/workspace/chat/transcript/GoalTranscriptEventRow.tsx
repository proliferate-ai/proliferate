import { useState } from "react";
// Matches the goal bar's own iconography exactly (GoalBar.tsx sources the
// same three glyphs from lucide-react directly — Target/CircleCheck aren't
// in the curated @proliferate/ui/icons set).
import { CircleAlert, CircleCheck, Target } from "lucide-react";
import { truncateGoalObjective } from "@proliferate/product-domain/activity/goal";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
import { Button } from "@proliferate/ui/primitives/Button";

// Compact row preview cap — the row also CSS-truncates to one line, but this
// keeps the label text itself short for the disclosure toggle's threshold.
const ROW_PREVIEW_MAX_CHARS = 88;

/**
 * A goal lifecycle transition row (goal_updated/goal_met/goal_cleared),
 * interleaved into the transcript by seq — client-side composition only (see
 * `deriveGoalTranscriptEvents`; the runtime keeps these chunks out of stored
 * transcript content). User-initiated events (set/edited) render as a
 * right-aligned compact chip (matching the "user placed this marker"
 * affordance); system outcomes (met/failed/blocked/cleared) render as quiet
 * left-aligned system rows. A long `goal_met` reason discloses on click,
 * matching `SessionErrorItem`'s "Details" toggle.
 */
export function GoalTranscriptEventRow({ event }: { event: GoalTranscriptEvent }) {
  const [expanded, setExpanded] = useState(false);
  const presentation = presentGoalTranscriptEvent(event);
  const canExpand = presentation.fullDetail !== null
    && presentation.fullDetail !== presentation.detailPreview;
  const isUserInitiated = event.kind === "set" || event.kind === "edited";

  if (isUserInitiated) {
    // User-initiated SET/EDIT events: right-aligned compact chip
    return (
      <div data-goal-transcript-event={event.kind} className="flex justify-end py-1">
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          disabled
          className="inline-flex items-start gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-ui-sm text-muted-foreground disabled:cursor-default"
        >
          {/* items-start + line-height-matched offset: the glyph registers on
              the FIRST text line instead of floating against the block's
              vertical center when the objective wraps. */}
          <presentation.Icon
            aria-hidden="true"
            className={`mt-[0.2em] size-3 shrink-0 ${presentation.iconClassName}`}
          />
          <span className="truncate">
            {presentation.label}
            {presentation.detailPreview && (
              <span className="text-faint"> — {presentation.detailPreview}</span>
            )}
          </span>
        </Button>
      </div>
    );
  }

  // System outcome events: left-aligned quiet row
  return (
    <div data-goal-transcript-event={event.kind} className="py-1">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        disabled={!canExpand}
        onClick={canExpand ? () => setExpanded((value) => !value) : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        className="flex w-full min-w-0 items-start gap-1.5 text-left text-ui-sm text-muted-foreground disabled:cursor-default"
      >
        <presentation.Icon
          aria-hidden="true"
          className={`mt-[0.2em] size-3 shrink-0 ${presentation.iconClassName}`}
        />
        <span className="min-w-0 truncate">
          {presentation.label}
          {presentation.detailPreview && (
            <span className="text-faint"> — {presentation.detailPreview}</span>
          )}
        </span>
        {canExpand && (
          <span className="shrink-0 text-faint underline decoration-dotted underline-offset-2">
            {expanded ? "Hide" : "Details"}
          </span>
        )}
      </Button>
      {expanded && presentation.fullDetail && (
        <div className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-card px-3.5 py-2.5 text-ui-sm leading-[1.65] tracking-[-0.01em] text-muted-foreground select-text">
          {presentation.fullDetail}
        </div>
      )}
    </div>
  );
}

interface GoalTranscriptEventPresentation {
  Icon: typeof Target;
  iconClassName: string;
  label: string;
  detailPreview: string | null;
  fullDetail: string | null;
}

function presentGoalTranscriptEvent(event: GoalTranscriptEvent): GoalTranscriptEventPresentation {
  const objectivePreview = truncateGoalObjective(event.objective, ROW_PREVIEW_MAX_CHARS);

  switch (event.kind) {
    case "set":
      return {
        Icon: Target,
        iconClassName: "text-faint",
        label: "Goal set",
        detailPreview: objectivePreview,
        fullDetail: null,
      };
    case "edited":
      return {
        Icon: Target,
        iconClassName: "text-faint",
        label: "Goal edited",
        detailPreview: objectivePreview,
        fullDetail: null,
      };
    case "paused":
      return {
        Icon: Target,
        iconClassName: "text-faint",
        label: "Goal paused",
        detailPreview: null,
        fullDetail: null,
      };
    case "resumed":
      return {
        Icon: Target,
        iconClassName: "text-faint",
        label: "Goal resumed",
        detailPreview: null,
        fullDetail: null,
      };
    case "blocked":
      return {
        Icon: CircleAlert,
        iconClassName: "text-warning",
        label: "Goal blocked",
        detailPreview: event.detail ? truncateGoalObjective(event.detail, ROW_PREVIEW_MAX_CHARS) : null,
        fullDetail: event.detail,
      };
    case "failed":
      return {
        Icon: CircleAlert,
        iconClassName: "text-destructive",
        label: "Goal stopped",
        detailPreview: event.detail ? truncateGoalObjective(event.detail, ROW_PREVIEW_MAX_CHARS) : null,
        fullDetail: event.detail,
      };
    case "met":
      return {
        Icon: CircleCheck,
        iconClassName: "text-muted-foreground",
        label: "Goal met",
        detailPreview: event.detail ? truncateGoalObjective(event.detail, ROW_PREVIEW_MAX_CHARS) : null,
        fullDetail: event.detail,
      };
    case "cleared":
      return {
        Icon: Target,
        iconClassName: "text-faint",
        label: "Goal cleared",
        detailPreview: null,
        fullDetail: null,
      };
  }
}
