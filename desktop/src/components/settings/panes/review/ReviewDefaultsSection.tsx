import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { RefreshCw } from "@/components/ui/icons";
import {
  clampRounds,
  DEFAULT_REVIEW_MAX_ROUNDS,
  MAX_REVIEW_ROUNDS,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";

interface ReviewDefaultsSectionProps {
  title: string;
  description: string;
  separated: boolean;
  defaults: StoredReviewKindDefaults | null;
  onChange: (
    updater: (current: StoredReviewKindDefaults | null) => StoredReviewKindDefaults | null,
  ) => void;
}

export function ReviewDefaultsSection({
  title,
  description,
  separated,
  defaults,
  onChange,
}: ReviewDefaultsSectionProps) {
  const effective = defaults ?? createDefaultReviewDefaults();
  const reviewersLabel = defaults === null
    ? "Unset, uses built-in reviewers"
    : effective.reviewers.mode === "inherit"
      ? "Built-in reviewers"
      : `${effective.reviewers.items.length} custom ${
        effective.reviewers.items.length === 1 ? "reviewer" : "reviewers"
      }`;

  const update = (patch: Partial<StoredReviewKindDefaults>) => {
    onChange((current) => ({
      ...createDefaultReviewDefaults(),
      ...current,
      ...patch,
    }));
  };

  return (
    <EnvironmentSection
      title={title}
      description={description}
      separated={separated}
      action={defaults ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(() => null)}>
          <RefreshCw className="size-3.5" />
          Reset
        </Button>
      ) : null}
    >
      <EnvironmentField label="Reviewers" description={reviewersLabel}>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={effective.reviewers.mode === "inherit" ? "secondary" : "outline"}
            size="sm"
            onClick={() => update({ reviewers: { mode: "inherit" } })}
          >
            Use built-ins
          </Button>
          <Button
            type="button"
            variant={effective.reviewers.mode === "custom" && effective.reviewers.items.length === 0
              ? "secondary"
              : "outline"}
            size="sm"
            onClick={() => update({ reviewers: { mode: "custom", items: [] } })}
          >
            Require config
          </Button>
        </div>
      </EnvironmentField>

      <EnvironmentField
        label="Max rounds"
        description={`One-click launches use ${DEFAULT_REVIEW_MAX_ROUNDS} rounds unless overridden.`}
      >
        <Input
          type="number"
          min={1}
          max={MAX_REVIEW_ROUNDS}
          value={effective.maxRounds}
          onChange={(event) => {
            const nextValue = event.target.valueAsNumber;
            update({
              maxRounds: Number.isFinite(nextValue)
                ? clampRounds(nextValue)
                : DEFAULT_REVIEW_MAX_ROUNDS,
            });
          }}
        />
      </EnvironmentField>

      <EnvironmentField
        label="Auto iterate"
        description="Automatically send feedback when a review round requests revisions."
      >
        <Label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={effective.autoIterate}
            onChange={(event) => update({ autoIterate: event.target.checked })}
          />
          Enabled
        </Label>
      </EnvironmentField>

      <EnvironmentField
        label="Agent defaults"
        description="Optional IDs used to seed new reviewer rows before falling back to the active session."
      >
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            value={effective.agentKind}
            placeholder="agent kind"
            onChange={(event) => update({ agentKind: event.target.value.trim() })}
          />
          <Input
            value={effective.modelId}
            placeholder="model id"
            onChange={(event) => update({ modelId: event.target.value.trim() })}
          />
          <Input
            value={effective.modeId}
            placeholder="mode id"
            onChange={(event) => update({ modeId: event.target.value.trim() })}
          />
        </div>
      </EnvironmentField>

      {effective.reviewers.mode === "custom" && effective.reviewers.items.length > 0 ? (
        <EnvironmentField
          label="Saved reviewer rows"
          description="Per-reviewer agent, model, and mode overrides are preserved."
        >
          <div className="space-y-2" data-telemetry-mask>
            {effective.reviewers.items.map((reviewer) => (
              <div key={reviewer.id} className="rounded-md border border-border px-3 py-2">
                <div className="text-sm font-medium text-foreground">{reviewer.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {reviewer.agentKind || "session agent"} · {reviewer.modelId || "session model"} · {reviewer.modeId || "session mode"}
                </div>
              </div>
            ))}
          </div>
        </EnvironmentField>
      ) : null}
    </EnvironmentSection>
  );
}

function createDefaultReviewDefaults(): StoredReviewKindDefaults {
  return {
    maxRounds: DEFAULT_REVIEW_MAX_ROUNDS,
    autoIterate: true,
    agentKind: "",
    modelId: "",
    modeId: "",
    reviewers: { mode: "inherit" },
  };
}
