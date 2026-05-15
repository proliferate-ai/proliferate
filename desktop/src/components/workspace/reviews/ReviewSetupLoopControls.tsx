import type { ReviewSetupDraft } from "@/lib/domain/reviews/review-config";
import { MAX_REVIEW_ROUNDS } from "@/lib/domain/reviews/review-config";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Minus, Plus } from "@/components/ui/icons";

interface ReviewSetupLoopControlsProps {
  draft: ReviewSetupDraft;
  onDraftChange: (draft: ReviewSetupDraft) => void;
}

export function ReviewSetupLoopControls({
  draft,
  onDraftChange,
}: ReviewSetupLoopControlsProps) {
  const setMaxRounds = (maxRounds: number) => {
    onDraftChange({
      ...draft,
      maxRounds: Math.min(MAX_REVIEW_ROUNDS, Math.max(1, maxRounds)),
    });
  };

  return (
    <section className="shrink-0 px-3 pb-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-foreground/5 px-2 py-1.5">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
          Max rounds
          <span className="inline-flex items-center overflow-hidden rounded-md border border-border/60 bg-background/40">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={draft.maxRounds <= 1}
              aria-label="Decrease max rounds"
              className="size-6 rounded-none"
              onClick={() => setMaxRounds(draft.maxRounds - 1)}
            >
              <Minus className="size-3" />
            </Button>
            <span className="min-w-6 text-center text-xs text-foreground tabular-nums">
              {draft.maxRounds}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={draft.maxRounds >= MAX_REVIEW_ROUNDS}
              aria-label="Increase max rounds"
              className="size-6 rounded-none"
              onClick={() => setMaxRounds(draft.maxRounds + 1)}
            >
              <Plus className="size-3" />
            </Button>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={draft.autoIterate}
            aria-label="Auto iterate"
            onChange={(autoIterate) => {
              onDraftChange({ ...draft, autoIterate });
            }}
          />
          <span className="whitespace-nowrap">Auto iterate</span>
        </div>
      </div>
    </section>
  );
}
