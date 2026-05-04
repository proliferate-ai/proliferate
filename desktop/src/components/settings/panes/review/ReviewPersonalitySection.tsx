import { useMemo } from "react";
import type { ReviewKind } from "@anyharness/sdk";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import {
  Plus,
  RefreshCw,
  Trash,
} from "@/components/ui/icons";
import {
  isBuiltInReviewPersonaId,
  resolveReviewPersonaTemplates,
  type ReviewPersonaTemplate,
  type ReviewPersonalityPreference,
} from "@/lib/domain/reviews/review-config";

interface ReviewPersonalitySectionProps {
  kind: ReviewKind;
  title: string;
  description: string;
  createLabel: string;
  separated: boolean;
  storedPersonalities: ReviewPersonalityPreference[];
  onCreate: () => void;
  onPromptChange: (
    kind: ReviewKind,
    personality: ReviewPersonaTemplate,
    prompt: string,
  ) => void;
  onReset: (kind: ReviewKind, personality: ReviewPersonaTemplate) => void;
  onDelete: (kind: ReviewKind, personality: ReviewPersonaTemplate) => void;
}

export function ReviewPersonalitySection({
  kind,
  title,
  description,
  createLabel,
  separated,
  storedPersonalities,
  onCreate,
  onPromptChange,
  onReset,
  onDelete,
}: ReviewPersonalitySectionProps) {
  const resolvedPersonalities = useMemo(
    () => resolveReviewPersonaTemplates(kind, storedPersonalities),
    [kind, storedPersonalities],
  );

  return (
    <section className={`space-y-2 ${separated ? "border-t border-border/60 pt-5" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          {createLabel}
        </Button>
      </div>

      <SettingsCard>
        {resolvedPersonalities.map((personality) => {
          const builtIn = isBuiltInReviewPersonaId(kind, personality.id);
          const overridden = builtIn
            && storedPersonalities.some((item) => item.id === personality.id);
          const descriptionText = builtIn
            ? overridden ? "Built-in personality with custom prompt" : "Built-in personality"
            : "Custom personality";

          return (
            <div key={personality.id} className="space-y-3 p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">{personality.label}</div>
                  <div className="text-sm text-muted-foreground">{descriptionText}</div>
                </div>
                {(overridden || !builtIn) ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {overridden ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onReset(kind, personality)}
                      >
                        <RefreshCw className="size-3.5" />
                        Reset
                      </Button>
                    ) : null}
                    {!builtIn ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(kind, personality)}
                      >
                        <Trash className="size-3.5" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Textarea
                variant="code"
                rows={6}
                value={personality.prompt}
                data-telemetry-mask
                placeholder="Tell this reviewer what to focus on."
                className="min-h-36 px-2.5 py-2 text-sm"
                onChange={(event) => onPromptChange(kind, personality, event.target.value)}
              />
            </div>
          );
        })}
      </SettingsCard>
    </section>
  );
}
