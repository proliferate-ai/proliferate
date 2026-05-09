import type { ReviewKind } from "@anyharness/sdk";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "@/components/ui/icons";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  createStoredReviewKindDefaults,
  type ReviewPersonaTemplate,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";
import { ReviewDefaultOptionRows } from "./ReviewDefaultOptionRows";
import { ReviewDefaultReviewerControls } from "./ReviewDefaultReviewerControls";

interface ReviewDefaultsSectionProps {
  kind: ReviewKind;
  title: string;
  description: string;
  separated: boolean;
  defaults: StoredReviewKindDefaults | null;
  personalityTemplates: ReviewPersonaTemplate[];
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onChange: (
    updater: (current: StoredReviewKindDefaults | null) => StoredReviewKindDefaults | null,
  ) => void;
}

export function ReviewDefaultsSection({
  kind,
  title,
  description,
  separated,
  defaults,
  personalityTemplates,
  modelGroups,
  modelsLoading,
  onChange,
}: ReviewDefaultsSectionProps) {
  const effective = defaults ?? createStoredReviewKindDefaults();

  const update = (patch: Partial<StoredReviewKindDefaults>) => {
    onChange((current) => ({
      ...createStoredReviewKindDefaults(),
      ...current,
      ...patch,
    }));
  };

  return (
    <section className={`space-y-2 ${separated ? "border-t border-border/60 pt-5" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {defaults ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(() => null)}>
            <RefreshCw className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>

      <SettingsCard>
        <ReviewDefaultReviewerControls
          kind={kind}
          defaults={defaults}
          effective={effective}
          personalityTemplates={personalityTemplates}
          modelGroups={modelGroups}
          modelsLoading={modelsLoading}
          onUpdate={update}
        />
        <ReviewDefaultOptionRows
          effective={effective}
          onUpdate={update}
        />
      </SettingsCard>
    </section>
  );
}
