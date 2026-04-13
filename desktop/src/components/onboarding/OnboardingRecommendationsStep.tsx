import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSummaryRow } from "@/components/ui/CollapsibleSummaryRow";
import { SelectionRow } from "@/components/ui/SelectionRow";
import { ProviderIcon } from "@/components/ui/icons";
import { ONBOARDING_COPY } from "@/config/onboarding";
import type { OnboardingRecommendationsStepState } from "@/hooks/onboarding/use-onboarding-recommendations-step";
import { OnboardingBrailleLoader } from "./OnboardingBrailleLoader";

interface OnboardingRecommendationsStepProps {
  state: OnboardingRecommendationsStepState;
  onContinue: () => void;
  onBack: () => void;
  onComplete: () => void;
}

export function OnboardingRecommendationsStep({
  state,
  onContinue,
  onBack,
  onComplete,
}: OnboardingRecommendationsStepProps) {
  if (state.status !== "ready") {
    return (
      <div className="space-y-6">
        {state.status === "loading"
          ? (
            <OnboardingBrailleLoader
              title={ONBOARDING_COPY.loadingTitle}
              detail={ONBOARDING_COPY.loadingDetail}
            />
          )
          : (
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium text-foreground">
                {ONBOARDING_COPY.deferredDefaultsTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                {ONBOARDING_COPY.deferredDefaultsDetail}
              </p>
            </div>
          )}
        <p className="text-center text-xs text-muted-foreground">
          {ONBOARDING_COPY.readyDetail}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onBack}
            className="h-11 flex-1"
          >
            Back
          </Button>
          <Button
            type="button"
            size="md"
            onClick={onComplete}
            className="h-11 flex-[2]"
          >
            {ONBOARDING_COPY.completeAction}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RecommendationsWizard
      state={state}
      onContinue={onContinue}
      onBack={onBack}
    />
  );
}

function RecommendationsWizard({
  state,
  onContinue,
  onBack,
}: {
  state: OnboardingRecommendationsStepState;
  onContinue: () => void;
  onBack: () => void;
}) {
  // Progressive-disclosure state: each pick advances to the next section.
  // Clicking a collapsed row re-expands that section without retreating the
  // farthest-reached index, so downstream sections stay visible in their
  // collapsed state even when the user edits an earlier choice.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [reachedIdx, setReachedIdx] = useState<number>(0);
  const [agentConfirmed, setAgentConfirmed] = useState(false);

  const selectedAgentDisplayName = state.selectedAgentKind
    ? state.agentOptions.find((option) => option.kind === state.selectedAgentKind)?.displayName
      ?? state.selectedAgentKind
    : null;
  const modelOptions = state.selectedAgentKind
    ? state.modelOptionsByAgentKind[state.selectedAgentKind] ?? []
    : [];
  const selectedModel = modelOptions.find((model) => model.id === state.selectedModelId);
  const modeOptions = state.selectedAgentKind
    ? state.modeOptionsByAgentKind[state.selectedAgentKind] ?? []
    : [];
  const selectedMode = modeOptions.find((option) => option.value === state.selectedModeId);

  const hasModel = modelOptions.length > 0;
  const hasPermissions = modeOptions.length > 0;

  const advance = useCallback(
    (
      fromIdx: number,
      nextShape?: { hasModel: boolean; hasPermissions: boolean },
    ) => {
      const nextHasModel = nextShape?.hasModel ?? hasModel;
      const nextHasPermissions = nextShape?.hasPermissions ?? hasPermissions;
      let next: number | null = null;
      if (fromIdx < 1 && nextHasModel) {
        next = 1;
      } else if (fromIdx < 2 && nextHasPermissions) {
        next = 2;
      }
      setReachedIdx((current) => Math.max(current, next ?? fromIdx));
      setExpandedIdx(next);
    },
    [hasModel, hasPermissions],
  );

  const handlePickAgent = useCallback(
    (kind: string) => {
      const nextHasModel = (state.modelOptionsByAgentKind[kind] ?? []).length > 0;
      const nextHasPermissions = (state.modeOptionsByAgentKind[kind] ?? []).length > 0;
      setAgentConfirmed(true);
      state.selectAgentKind(kind);
      advance(0, { hasModel: nextHasModel, hasPermissions: nextHasPermissions });
    },
    [advance, state],
  );

  const handlePickModel = useCallback(
    (modelId: string) => {
      state.selectModelId(modelId);
      advance(1);
    },
    [advance, state],
  );

  const handlePickMode = useCallback(
    (modeId: string) => {
      state.selectModeId(modeId);
      advance(2);
    },
    [advance, state],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <ProgressiveSection
          label={ONBOARDING_COPY.recommendationAgentLabel}
          expanded={expandedIdx === 0}
          selectedLabel={
            agentConfirmed
              ? (selectedAgentDisplayName ?? "—")
              : selectedAgentDisplayName
                ? `${ONBOARDING_COPY.recommendationSummaryPrefix} ${selectedAgentDisplayName}`
                : "Choose an agent"
          }
          onExpand={() => setExpandedIdx(0)}
        >
          <p className="text-xs text-muted-foreground">
            {ONBOARDING_COPY.recommendationAgentHint}
          </p>
          {state.agentOptions.map((option) => (
            <SelectionRow
              key={option.kind}
              selected={agentConfirmed && option.kind === state.selectedAgentKind}
              onClick={() => handlePickAgent(option.kind)}
              icon={<ProviderIcon kind={option.kind} className="size-5" />}
              label={option.displayName}
              subtitle={
                !agentConfirmed && option.kind === state.recommendation?.agentKind
                  ? ONBOARDING_COPY.recommendationSuggestedLabel
                  : undefined
              }
            />
          ))}
        </ProgressiveSection>

        {hasModel && agentConfirmed && reachedIdx >= 1 && (
          <ProgressiveSection
            label={ONBOARDING_COPY.recommendationModelLabel}
            expanded={expandedIdx === 1}
            selectedLabel={selectedModel?.displayName ?? "—"}
            onExpand={() => setExpandedIdx(1)}
          >
            {modelOptions.map((model) => (
              <SelectionRow
                key={model.id}
                selected={model.id === state.selectedModelId}
                onClick={() => handlePickModel(model.id)}
                label={model.displayName}
              />
            ))}
          </ProgressiveSection>
        )}

        {hasPermissions && agentConfirmed && reachedIdx >= 2 && (
          <ProgressiveSection
            label={ONBOARDING_COPY.recommendationPermissionsLabel}
            expanded={expandedIdx === 2}
            selectedLabel={selectedMode?.label ?? "—"}
            onExpand={() => setExpandedIdx(2)}
          >
            {modeOptions.map((option) => (
              <SelectionRow
                key={option.value}
                selected={option.value === state.selectedModeId}
                onClick={() => handlePickMode(option.value)}
                label={option.label}
              />
            ))}
          </ProgressiveSection>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {ONBOARDING_COPY.readyDetail}
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onBack}
          className="h-11 flex-1"
        >
          Back
        </Button>
        <Button
          type="button"
          size="md"
          onClick={onContinue}
          disabled={
            !agentConfirmed
            || !state.selectedAgentKind
            || !state.selectedModelId
          }
          className="h-11 flex-[2]"
        >
          {ONBOARDING_COPY.completeAction}
        </Button>
      </div>
    </div>
  );
}

function ProgressiveSection({
  label,
  expanded,
  selectedLabel,
  onExpand,
  children,
}: {
  label: string;
  expanded: boolean;
  selectedLabel: string;
  onExpand: () => void;
  children: ReactNode;
}) {
  if (!expanded) {
    return (
      <CollapsibleSummaryRow
        label={label}
        value={selectedLabel}
        onClick={onExpand}
      />
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
