import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@/components/ui/Input";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import {
  AUTOMATION_REASONING_EFFORT_OPTIONS,
} from "@/lib/domain/automations/options-presentation";
import { useAutomationModelSelection } from "@/hooks/automations/use-automation-model-selection";
import { useAutomationModeSelection } from "@/hooks/automations/use-automation-mode-selection";
import { useAutomationTargetSelection } from "@/hooks/automations/use-automation-target-selection";
import type {
  AutomationModelOverride,
  AutomationModelSelection,
} from "@/lib/domain/automations/model-selection";
import type { AutomationModeOverride } from "@/lib/domain/automations/mode-selection";
import type { AutomationTargetSelection } from "@/lib/domain/automations/target-selection";
import type {
  AutomationResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/integrations/cloud/client";
import {
  defaultAutomationTimezone,
  presetForRrule,
  rruleForPresetAtTime,
  validateAutomationRrule,
  validateAutomationTimezone,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule";
import {
  AutomationSchedulePopover,
  AutomationSelectPopover,
  AutomationTemplatePopover,
  reasoningIcon,
} from "./AutomationEditorControls";
import { AutomationModePicker } from "./AutomationModePicker";
import { AutomationModelPicker } from "./AutomationModelPicker";
import { AutomationTargetPicker } from "./AutomationTargetPicker";

type SchedulePresetValue = AutomationSchedulePresetOrCustom;

interface AutomationEditorModalProps {
  open: boolean;
  automation: AutomationResponse | null;
  busy: boolean;
  onClose: () => void;
  onConfigureCloudTarget: (target: { gitOwner: string; gitRepoName: string }) => void;
  onCreate: (body: CreateAutomationRequest) => Promise<void>;
  onUpdate: (automationId: string, body: UpdateAutomationRequest) => Promise<void>;
}

export function AutomationEditorModal({
  open,
  automation,
  busy,
  onClose,
  onConfigureCloudTarget,
  onCreate,
  onUpdate,
}: AutomationEditorModalProps) {
  const [title, setTitle] = useState(automation?.title ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [targetOverride, setTargetOverride] = useState<AutomationTargetSelection | null>(null);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetValue>(
    automation ? presetForRrule(automation.schedule.rrule) : "daily",
  );
  const [rrule, setRrule] = useState(
    automation?.schedule.rrule ?? rruleForPresetAtTime("daily"),
  );
  const [timezone, setTimezone] = useState(
    automation?.schedule.timezone ?? defaultAutomationTimezone(),
  );
  const [modelOverride, setModelOverride] = useState<AutomationModelOverride | null>(null);
  const [modeOverride, setModeOverride] = useState<AutomationModeOverride | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState(
    automation?.reasoningEffort ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingConfigureTarget, setPendingConfigureTarget] = useState<{
    gitOwner: string;
    gitRepoName: string;
  } | null>(null);

  const modelSelection = useAutomationModelSelection({
    savedAgentKind: automation?.agentKind ?? null,
    savedModelId: automation?.modelId ?? null,
    override: modelOverride,
    isEditing: !!automation,
  });
  const modeSelection = useAutomationModeSelection({
    agentKind: modelSelection.resolution.submission.agentKind,
    savedModeId: automation?.modeId ?? null,
    override: modeOverride,
    useSavedMode: !!automation && !modelOverride && !modeOverride,
  });
  const modelSubmission = modelSelection.resolution.submission;
  const modeSubmission = modeSelection.resolution.submission;
  const saveDisabledReason = modelSelection.disabledReason;
  const targetSelection = useAutomationTargetSelection({
    automation,
    selectedTarget: targetOverride,
    enabled: open,
  });
  const selectedTarget = targetSelection.selectedTarget;

  const submit = async () => {
    setError(null);
    if (!title.trim() || !prompt.trim()) {
      setError("Add a title and prompt before saving.");
      return;
    }
    if (!targetSelection.canSubmit || !selectedTarget) {
      setError(targetSelection.disabledReason ?? "Select a target before saving.");
      return;
    }
    if (!modelSubmission.canSubmit) {
      setError(saveDisabledReason ?? "Choose a supported model before saving.");
      return;
    }
    const timezoneError = validateAutomationTimezone(timezone);
    if (timezoneError) {
      setError(timezoneError);
      return;
    }
    const rruleError = validateAutomationRrule(rrule);
    if (rruleError) {
      setError(rruleError);
      return;
    }
    const schedule = { rrule: rrule.trim(), timezone: timezone.trim() };
    const optionalFields = {
      agentKind: modelSubmission.agentKind,
      modelId: modelSubmission.modelId,
      modeId: modeSubmission.modeId,
      reasoningEffort: reasoningEffort.trim() || null,
    };
    try {
      if (automation) {
        await onUpdate(automation.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          schedule,
          executionTarget: selectedTarget.executionTarget,
          ...optionalFields,
        });
      } else {
        await onCreate({
          title: title.trim(),
          prompt: prompt.trim(),
          gitOwner: selectedTarget.gitOwner,
          gitRepoName: selectedTarget.gitRepoName,
          schedule,
          executionTarget: selectedTarget.executionTarget,
          ...optionalFields,
        });
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save automation.");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleRruleChange = (nextRrule: string) => {
    setRrule(nextRrule);
    setSchedulePreset(presetForRrule(nextRrule));
  };

  const handleModelSelect = (selection: AutomationModelSelection) => {
    const currentAgentKind = modelSelection.resolution.submission.agentKind;
    if (currentAgentKind === selection.kind) {
      setModeOverride({ modeId: modeSelection.resolution.submission.modeId });
    } else {
      setModeOverride(null);
    }
    setModelOverride(selection);
  };

  const handleDefaultModelSelect = () => {
    const currentAgentKind = modelSelection.resolution.submission.agentKind;
    if (!currentAgentKind || !modelSelection.resolution.submission.canSubmit) {
      return;
    }
    setModelOverride({ kind: currentAgentKind, modelId: null });
    setModeOverride({ modeId: modeSelection.resolution.submission.modeId });
  };

  const hasDraftChanges = () => {
    const initialRrule = automation?.schedule.rrule ?? rruleForPresetAtTime("daily");
    const initialTimezone = automation?.schedule.timezone ?? defaultAutomationTimezone();
    return title.trim() !== (automation?.title ?? "").trim()
      || prompt.trim() !== (automation?.prompt ?? "").trim()
      || rrule.trim() !== initialRrule.trim()
      || timezone.trim() !== initialTimezone.trim()
      || reasoningEffort.trim() !== (automation?.reasoningEffort ?? "").trim()
      || targetOverride !== null
      || modelOverride !== null
      || modeOverride !== null;
  };

  const handleConfigureCloudTarget = (target: { gitOwner: string; gitRepoName: string }) => {
    if (hasDraftChanges()) {
      setPendingConfigureTarget(target);
      return;
    }
    onConfigureCloudTarget(target);
  };

  const handleConfirmConfigureCloudTarget = () => {
    const target = pendingConfigureTarget;
    if (!target) {
      return;
    }
    setPendingConfigureTarget(null);
    onConfigureCloudTarget(target);
  };

  const reasoningOptions = [
    { value: "", label: "Default" },
    ...AUTOMATION_REASONING_EFFORT_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        disableClose={busy || pendingConfigureTarget !== null}
        title={automation ? "Edit automation" : "Create automation"}
        description="Create a scheduled automation."
        sizeClassName="max-h-[95vh] max-w-[800px]"
        bodyClassName="flex min-h-[24rem] flex-col px-5 pb-5 pt-0"
        panelClassName="border-border bg-background/95 shadow-lg backdrop-blur-xl"
        headerContent={(
          <div className="flex min-w-0 items-center justify-between gap-4 pt-2">
            <Input
              id="automation-title"
              data-testid="automation-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Automation title"
              placeholder="Automation title"
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 pr-2 text-lg leading-tight shadow-none outline-none placeholder:text-muted-foreground focus:ring-0"
            />
            <AutomationTemplatePopover
              onSelectTemplate={(template) => {
                if (!title.trim()) {
                  setTitle(template.title);
                }
                setPrompt(template.prompt);
              }}
            />
          </div>
        )}
      >
        <form
          id="automation-form"
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {error && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <Textarea
              id="automation-prompt"
              variant="ghost"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Prompt"
              placeholder="Add prompt e.g. look for crashes in $sentry"
              className="min-h-[16rem] px-0 text-base leading-relaxed placeholder:text-muted-foreground"
            />
          </div>
          <div className="shrink-0 pt-3">
            {!automation && !targetSelection.isLoading && targetSelection.groups.length === 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                Add a local repository with a GitHub remote, or create a cloud workspace first.
              </p>
            )}
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <AutomationTargetPicker
                  groups={targetSelection.groups}
                  selectedRow={targetSelection.selectedRow}
                  isLoading={targetSelection.isLoading}
                  disabledReason={targetSelection.disabledReason}
                  onSelect={setTargetOverride}
                  onConfigureCloud={handleConfigureCloudTarget}
                />
                <AutomationSchedulePopover
                  schedulePreset={schedulePreset}
                  rrule={rrule}
                  timezone={timezone}
                  onSchedulePresetChange={setSchedulePreset}
                  onRruleChange={handleRruleChange}
                  onTimezoneChange={setTimezone}
                  onRruleBlur={() => setError(validateAutomationRrule(rrule))}
                />
                <AutomationModelPicker
                  groups={modelSelection.groups}
                  resolution={modelSelection.resolution}
                  isLoading={modelSelection.isLoading}
                  disabledReason={modelSelection.disabledReason}
                  onSelect={handleModelSelect}
                  onDefaultSelect={handleDefaultModelSelect}
                />
                <AutomationModePicker
                  options={modeSelection.options}
                  resolution={modeSelection.resolution}
                  disabled={!modelSubmission.agentKind}
                  onSelect={(modeId) => setModeOverride({ modeId })}
                  onDefaultSelect={() => setModeOverride({ modeId: null })}
                />
                <AutomationSelectPopover
                  label="Reasoning"
                  value={reasoningEffort}
                  options={reasoningOptions}
                  onChange={setReasoningEffort}
                  icon={reasoningIcon()}
                  className="max-w-[11rem]"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={
                    (!automation && (modelSelection.isLoading || targetSelection.isLoading))
                    || !modelSubmission.canSubmit
                    || !targetSelection.canSubmit
                  }
                >
                  {automation ? "Save" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </ModalShell>
      <ConfirmationDialog
        open={pendingConfigureTarget !== null}
        onClose={() => setPendingConfigureTarget(null)}
        onConfirm={handleConfirmConfigureCloudTarget}
        title="Discard automation draft?"
        description="Opening cloud repo settings will close this automation draft."
        confirmLabel="Open settings"
      />
    </>
  );
}
