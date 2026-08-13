import { useState } from "react";
// Matches the goal bar's own iconography exactly (GoalBar.tsx sources the
// same glyphs).
import { Target } from "#product/primitives/icons/product";
import { CircleAlert, CircleCheck } from "#product/primitives/icons/status";
import { truncateGoalObjective } from "#product/domain/activity/goal";
import type { GoalTranscriptEvent } from "#product/domain/activity/goal-transcript-events";
import { Button } from "#product/primitives/Button";
import { Card } from "#product/primitives/patterns/Card";

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
            className={`mt-[0.2em] icon-compact shrink-0 [font-size:var(--text-chat)] ${presentation.iconClassName}`}
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

  // System outcome events: left-aligned quiet row.
  //
  // Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review, check 1) for
  // the whole quiet-disclosure family in the transcript, of which this is one:
  // the landed `Disclosure` always paints `hover:bg-hover active:bg-active` on
  // its header row and exposes no way to suppress it — `className` lands on the
  // outer wrapper, not the row. Adopting it here would put a pressed background
  // back on exactly the rows PRO-120 (#1747) removed one from. It also renders a
  // rotating chevron where these rows use a status glyph, and a 17px
  // `text-heading` title where the transcript runs at 13-14px. Landing this
  // family needs a quiet spelling of `Disclosure`, which is a review ruling.
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
          className={`mt-[0.2em] icon-compact shrink-0 [font-size:var(--text-chat)] ${presentation.iconClassName}`}
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
        <Card surface="opaque" className="mt-1">
          {/*
            tracking-[-0.01em] is a recorded cause (DESIGN_SYSTEM.md
            § UI-conformance review, check 4): raw agent output is wrapped
            pre-formatted text, and the slight negative tracking is what keeps a
            long single line inside the transcript column at this size. It is
            optical, not a scale step.
          */}
          <div className="whitespace-pre-wrap px-3.5 py-2.5 text-ui-sm leading-relaxed tracking-[-0.01em] text-muted-foreground select-text">
            {presentation.fullDetail}
          </div>
        </Card>
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
        iconClassName: "text-warning-foreground",
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
