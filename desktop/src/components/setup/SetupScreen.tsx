import { useState } from "react";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { Button } from "@/components/ui/Button";
import { SelectionRow } from "@/components/ui/SelectionRow";
import { StepDots } from "@/components/ui/StepDots";
import { ProliferateLogo } from "@/components/brand/ProliferateLogo";
import { ProviderIcon } from "@/components/ui/icons";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { SETUP_COPY } from "@/config/setup";
import type { SetupPageState } from "@/hooks/setup/use-setup-page-state";

export function SetupScreen({
  requirementKind,
  stepIndex,
  stepCount,
  openTargetStep,
  chatDefaultsStep,
}: SetupPageState) {
  if (!requirementKind) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <ProliferateLogo />

        <StepDots count={stepCount} current={stepIndex} />

        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {SETUP_COPY.titles[requirementKind]}
          </h1>
          <p className="text-base text-muted-foreground">
            {SETUP_COPY.descriptions[requirementKind]}
          </p>
        </div>

        <div className="w-full">
          {requirementKind === "open-target" && (
            <OpenTargetStepContent
              options={openTargetStep.options}
              selectedId={openTargetStep.selectedId}
              onSelect={openTargetStep.onSelect}
              onContinue={openTargetStep.onContinue}
            />
          )}
          {requirementKind === "chat-defaults" && (
            <ChatDefaultsStepContent
              state={chatDefaultsStep.state}
              options={chatDefaultsStep.options}
              selected={chatDefaultsStep.selected}
              selectedModels={chatDefaultsStep.selectedModels}
              modeOptions={chatDefaultsStep.modeOptions}
              selectedModeId={chatDefaultsStep.selectedModeId}
              onSelectAgent={chatDefaultsStep.onSelectAgent}
              onSelectModel={chatDefaultsStep.onSelectModel}
              onSelectMode={chatDefaultsStep.onSelectMode}
              onContinue={chatDefaultsStep.onContinue}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OpenTargetStepContent({
  options,
  selectedId,
  onSelect,
  onContinue,
}: {
  options: SetupPageState["openTargetStep"]["options"];
  selectedId: string;
  onSelect: (targetId: string | null) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {options.map((target) => (
          <SelectionRow
            key={target.id}
            selected={target.id === selectedId}
            onClick={() => onSelect(target.id)}
            icon={<OpenTargetIcon iconId={target.iconId} className="size-5 rounded-sm" />}
            label={target.label}
          />
        ))}
      </div>
      <Button
        type="button"
        size="md"
        onClick={onContinue}
        disabled={!selectedId}
        className="h-11 w-full"
      >
        {SETUP_COPY.openTargetAction}
      </Button>
    </div>
  );
}

type DefaultsSubStep = "agent" | "model" | "mode";

function ChatDefaultsStepContent({
  state,
  options,
  selected,
  selectedModels,
  modeOptions,
  selectedModeId,
  onSelectAgent,
  onSelectModel,
  onSelectMode,
  onContinue,
}: {
  state: SetupPageState["chatDefaultsStep"]["state"];
  options: SetupPageState["chatDefaultsStep"]["options"];
  selected: SetupPageState["chatDefaultsStep"]["selected"];
  selectedModels: SetupPageState["chatDefaultsStep"]["selectedModels"];
  modeOptions: SetupPageState["chatDefaultsStep"]["modeOptions"];
  selectedModeId: SetupPageState["chatDefaultsStep"]["selectedModeId"];
  onSelectAgent: (kind: string) => void;
  onSelectModel: (kind: string, modelId: string) => void;
  onSelectMode: (kind: string, modeId: string) => void;
  onContinue: () => void;
}) {
  const [subStep, setSubStep] = useState<DefaultsSubStep>("agent");

  if (state.status !== "ready") {
    return (
      <div>
        {state.status === "loading" ? (
          <LoadingState message={state.message} subtext={state.detail} />
        ) : (
          <p className="text-center text-sm text-destructive">{state.message}</p>
        )}
      </div>
    );
  }

  const hasModels = selectedModels.length > 0;
  const hasModes = modeOptions.length > 0 && !!selected;

  const advance = () => {
    if (subStep === "agent") {
      if (hasModels) setSubStep("model");
      else if (hasModes) setSubStep("mode");
      else onContinue();
    } else if (subStep === "model") {
      if (hasModes) setSubStep("mode");
      else onContinue();
    } else {
      onContinue();
    }
  };

  const isLast =
    subStep === "mode" ||
    (subStep === "model" && !hasModes) ||
    (subStep === "agent" && !hasModels && !hasModes);

  const selectedAgent = options.find((o) => o.kind === selected?.kind);
  const selectedModel = selectedModels.find(
    (m) => m.id === selected?.modelId,
  );
  return (
    <div className="space-y-4">
      {/* Completed-choice summaries */}
      {subStep !== "agent" && selectedAgent && (
        <CompletedChoice
          label="Agent"
          value={selectedAgent.displayName}
          icon={
            <ProviderIcon kind={selectedAgent.kind} className="size-4" />
          }
          onEdit={() => setSubStep("agent")}
        />
      )}
      {subStep === "mode" && selectedModel && (
        <CompletedChoice
          label="Model"
          value={selectedModel.displayName}
          onEdit={() => setSubStep("model")}
        />
      )}

      {/* Current section */}
      {subStep === "agent" && (
        <>
          <SectionLabel>Agent</SectionLabel>
          <div className="space-y-1.5">
            {options.map((option) => (
              <SelectionRow
                key={option.kind}
                selected={option.kind === selected?.kind}
                onClick={() => onSelectAgent(option.kind)}
                icon={
                  <ProviderIcon kind={option.kind} className="size-5" />
                }
                label={option.displayName}
                subtitle={option.readinessLabel}
              />
            ))}
          </div>
        </>
      )}

      {subStep === "model" && (
        <>
          <SectionLabel>Model</SectionLabel>
          <div className="space-y-1.5">
            {selectedModels.map((model) => (
              <SelectionRow
                key={model.id}
                selected={model.id === selected?.modelId}
                onClick={() =>
                  selected && onSelectModel(selected.kind, model.id)
                }
                label={model.displayName}
              />
            ))}
          </div>
        </>
      )}

      {subStep === "mode" && (
        <>
          <SectionLabel>Permissions</SectionLabel>
          <div className="space-y-1.5">
            {modeOptions.map((option) => (
              <SelectionRow
                key={option.value}
                selected={option.value === selectedModeId}
                onClick={() =>
                  selected && onSelectMode(selected.kind, option.value)
                }
                label={option.shortLabel ?? option.label}
                subtitle={option.description ?? undefined}
              />
            ))}
          </div>
        </>
      )}

      <Button
        type="button"
        size="md"
        onClick={advance}
        disabled={!selected}
        className="h-11 w-full"
      >
        {isLast ? SETUP_COPY.chatDefaultsAction : "Continue"}
      </Button>
    </div>
  );
}

function CompletedChoice({
  label,
  value,
  icon,
  onEdit,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors duration-150 hover:bg-foreground/[0.03]"
    >
      {icon}
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
      <span className="ml-auto text-xs text-muted-foreground">Edit</span>
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}
