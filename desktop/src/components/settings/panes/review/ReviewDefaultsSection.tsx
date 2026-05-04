import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import { ProviderIcon, RefreshCw, Sparkles } from "@/components/ui/icons";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-mode-control";
import {
  clampRounds,
  DEFAULT_REVIEW_MAX_ROUNDS,
  MAX_REVIEW_ROUNDS,
  resolveReviewExecutionModeIdForAgent,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";

interface ReviewDefaultsSectionProps {
  title: string;
  description: string;
  separated: boolean;
  defaults: StoredReviewKindDefaults | null;
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onChange: (
    updater: (current: StoredReviewKindDefaults | null) => StoredReviewKindDefaults | null,
  ) => void;
}

export function ReviewDefaultsSection({
  title,
  description,
  separated,
  defaults,
  modelGroups,
  modelsLoading,
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
        description="Optional selections used to seed new reviewer rows before falling back to the active session."
      >
        <div className="grid gap-2 md:grid-cols-2">
          <ReviewDefaultModelMenu
            defaults={effective}
            modelGroups={modelGroups}
            modelsLoading={modelsLoading}
            onSelect={(group, modelId) => update({
              agentKind: group.kind,
              modelId,
              modeId: resolveReviewExecutionModeIdForAgent(group.kind, effective.modeId),
            })}
            onInherit={() => update({ agentKind: "", modelId: "", modeId: "" })}
          />
          <ReviewDefaultModeMenu
            defaults={effective}
            onSelect={(modeId) => update({ modeId })}
            onInherit={() => update({ modeId: "" })}
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

function ReviewDefaultModelMenu({
  defaults,
  modelGroups,
  modelsLoading,
  onSelect,
  onInherit,
}: {
  defaults: StoredReviewKindDefaults;
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onSelect: (group: AgentModelGroup, modelId: string) => void;
  onInherit: () => void;
}) {
  const selected = selectedDefaultModel(modelGroups, defaults);
  const hasStoredSelection = !!defaults.agentKind || !!defaults.modelId;
  const label = selected
    ? `${selected.group.providerDisplayName} · ${selected.model.displayName}`
    : modelsLoading
      ? "Loading models"
      : hasStoredSelection
        ? "Saved model unavailable"
        : "Active session model";
  const leading = selected
    ? <ProviderIcon kind={selected.group.kind} className="size-3.5" />
    : <Sparkles className="size-3.5 text-muted-foreground" />;

  return (
    <SettingsMenu
      label={label}
      leading={leading}
      className="w-full min-w-0"
      menuClassName="w-80"
      groups={[
        {
          id: "inherit",
          options: [{
            id: "inherit-active-session-model",
            label: "Active session model",
            detail: "Use the parent session agent and model",
            icon: <Sparkles className="size-3.5" />,
            selected: !defaults.agentKind && !defaults.modelId,
            onSelect: onInherit,
          }],
        },
        ...modelGroups.map((group) => ({
          id: group.kind,
          label: group.providerDisplayName,
          options: group.models.map((model) => ({
            id: `${group.kind}:${model.modelId}`,
            label: model.displayName,
            detail: model.description,
            icon: <ProviderIcon kind={group.kind} className="size-3.5" />,
            selected: defaults.agentKind === group.kind && defaults.modelId === model.modelId,
            onSelect: () => onSelect(group, model.modelId),
          })),
        })),
      ]}
    />
  );
}

function ReviewDefaultModeMenu({
  defaults,
  onSelect,
  onInherit,
}: {
  defaults: StoredReviewKindDefaults;
  onSelect: (modeId: string) => void;
  onInherit: () => void;
}) {
  const modeOptions = listConfiguredSessionControlValues(defaults.agentKind, "mode");
  const selectedMode = resolveConfiguredSessionControlValue(
    defaults.agentKind,
    "mode",
    defaults.modeId,
  );
  const label = !defaults.agentKind
    ? "Active session mode"
    : selectedMode
      ? selectedMode.shortLabel ?? selectedMode.label
      : "Default mode";
  const groups = [
    {
      id: "inherit",
      options: [{
        id: "inherit-active-session-mode",
        label: defaults.agentKind ? "Default mode" : "Active session mode",
        detail: defaults.agentKind
          ? "Use the active session mode when available"
          : "Choose a model default to customize this",
        icon: <Sparkles className="size-3.5" />,
        selected: !defaults.modeId,
        onSelect: onInherit,
      }],
    },
    ...(modeOptions.length > 0 ? [{
      id: "modes",
      label: "Modes",
      options: modeOptions.map((mode) => ({
        id: mode.value,
        label: mode.label,
        detail: mode.description,
        icon: <SessionControlIcon icon={mode.icon} className="size-3.5" />,
        selected: defaults.modeId === mode.value,
        onSelect: () => onSelect(mode.value),
      })),
    }] : []),
  ];

  return (
    <SettingsMenu
      label={label}
      leading={selectedMode
        ? <SessionControlIcon icon={selectedMode.icon} className="size-3.5" />
        : <Sparkles className="size-3.5 text-muted-foreground" />}
      className="w-full min-w-0"
      menuClassName="w-72"
      groups={groups}
    />
  );
}

function selectedDefaultModel(
  modelGroups: AgentModelGroup[],
  defaults: StoredReviewKindDefaults,
): { group: AgentModelGroup; model: AgentModelGroup["models"][number] } | null {
  const group = modelGroups.find((candidate) => candidate.kind === defaults.agentKind) ?? null;
  const model = group?.models.find((candidate) => candidate.modelId === defaults.modelId) ?? null;
  return group && model ? { group, model } : null;
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
