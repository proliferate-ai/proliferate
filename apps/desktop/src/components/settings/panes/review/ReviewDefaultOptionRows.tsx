import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import {
  clampRounds,
  DEFAULT_REVIEW_MAX_ROUNDS,
  MAX_REVIEW_ROUNDS,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";

interface ReviewDefaultOptionRowsProps {
  effective: StoredReviewKindDefaults;
  onUpdate: (patch: Partial<StoredReviewKindDefaults>) => void;
}

export function ReviewDefaultOptionRows({
  effective,
  onUpdate,
}: ReviewDefaultOptionRowsProps) {
  return (
    <>
      <SettingsCardRow
        label="Max rounds"
        description={`One-click launches use ${DEFAULT_REVIEW_MAX_ROUNDS} rounds unless overridden.`}
      >
        <Input
          type="number"
          min={1}
          max={MAX_REVIEW_ROUNDS}
          value={effective.maxRounds}
          className="w-24"
          onChange={(event) => {
            const nextValue = event.target.valueAsNumber;
            onUpdate({
              maxRounds: Number.isFinite(nextValue)
                ? clampRounds(nextValue)
                : DEFAULT_REVIEW_MAX_ROUNDS,
            });
          }}
        />
      </SettingsCardRow>

      <SettingsCardRow
        label="Auto iterate"
        description="Automatically send feedback when a review round requests revisions."
      >
        <Label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={effective.autoIterate}
            onChange={(event) => onUpdate({ autoIterate: event.target.checked })}
          />
          Enabled
        </Label>
      </SettingsCardRow>
    </>
  );
}
