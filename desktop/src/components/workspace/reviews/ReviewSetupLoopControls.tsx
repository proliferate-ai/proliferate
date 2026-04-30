import type { ReviewSetupDraft } from "@/lib/domain/reviews/review-config";
import { MAX_REVIEW_ROUNDS } from "@/lib/domain/reviews/review-config";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";

interface ReviewSetupLoopControlsProps {
  draft: ReviewSetupDraft;
  reviewerCount: number;
  estimatedSessions: number;
  onDraftChange: (draft: ReviewSetupDraft) => void;
}

export function ReviewSetupLoopControls({
  draft,
  reviewerCount,
  estimatedSessions,
  onDraftChange,
}: ReviewSetupLoopControlsProps) {
  return (
    <section className="shrink-0 border-b border-border/60 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Label className="flex shrink-0 items-center gap-2 whitespace-nowrap py-1 text-xs text-muted-foreground">
            Max rounds
            <Select
              value={String(draft.maxRounds)}
              className="h-7 w-16 px-2 pr-7 text-xs"
              onChange={(event) => {
                onDraftChange({ ...draft, maxRounds: Number(event.target.value) });
              }}
            >
              {Array.from({ length: MAX_REVIEW_ROUNDS }, (_, index) => index + 1).map(
                (round) => (
                  <option key={round} value={round}>
                    {round}
                  </option>
                ),
              )}
            </Select>
          </Label>

          <div className="flex shrink-0 items-center gap-2 py-1 text-xs text-muted-foreground">
            <Switch
              checked={draft.autoSendFeedback}
              aria-label="Auto iterate"
              onChange={(autoSendFeedback) => {
                onDraftChange({ ...draft, autoSendFeedback });
              }}
            />
            <span className="whitespace-nowrap">Auto iterate</span>
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {reviewerCount} reviewer{reviewerCount === 1 ? "" : "s"} · up to {estimatedSessions} sessions
        </div>
      </div>
    </section>
  );
}
