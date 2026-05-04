import { useMemo } from "react";
import type { ReviewKind } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import {
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
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
    <EnvironmentSection
      title={title}
      description={description}
      separated={separated}
      action={(
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          {createLabel}
        </Button>
      )}
    >
      {resolvedPersonalities.map((personality) => {
        const builtIn = isBuiltInReviewPersonaId(kind, personality.id);
        const overridden = builtIn
          && storedPersonalities.some((item) => item.id === personality.id);
        const descriptionText = builtIn
          ? overridden ? "Built-in personality with custom prompt" : "Built-in personality"
          : "Custom personality";

        return (
          <EnvironmentField
            key={personality.id}
            label={personality.label}
            description={descriptionText}
          >
            <div className="space-y-2">
              <Textarea
                variant="code"
                rows={6}
                value={personality.prompt}
                data-telemetry-mask
                placeholder="Tell this reviewer what to focus on."
                className="min-h-36 px-2.5 py-2 text-sm"
                onChange={(event) => onPromptChange(kind, personality, event.target.value)}
              />
              {(overridden || !builtIn) ? (
                <div className="flex justify-end gap-2">
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
          </EnvironmentField>
        );
      })}
    </EnvironmentSection>
  );
}
