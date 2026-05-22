import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { useAutomationTargetSelection } from "@/hooks/automations/derived/use-automation-target-selection";
import type { AutomationTargetSelection } from "@/lib/domain/automations/target/selection";
import type {
  AutomationRecord,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/domain/automations/run/ui-records";
import type { AutomationOwnerScope, AutomationTargetMode } from "@/lib/access/cloud/client";
import { useAgentRunConfigs } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-configs";
import {
  defaultAutomationTimezone,
  presetForRrule,
  rruleForPresetAtTime,
  validateAutomationRrule,
  validateAutomationTimezone,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule/schedule";
import {
  AutomationSchedulePopover,
  AutomationTemplatePopover,
} from "./AutomationEditorControls";
import { AutomationAgentRunConfigPicker } from "@/components/automations/controls/AutomationAgentRunConfigPicker";
import { AutomationRunLocationSelector } from "@/components/automations/controls/AutomationRunLocationSelector";

type SchedulePresetValue = AutomationSchedulePresetOrCustom;

interface AutomationEditorModalProps {
  open: boolean;
  automation: AutomationRecord | null;
  busy: boolean;
  initialOwnerScope: AutomationOwnerScope;
  organizationId: string | null;
  organizationName?: string | null;
  canManageTeamAutomations: boolean;
  onClose: () => void;
  onConfigureCloudTarget: (target: { gitOwner: string; gitRepoName: string }) => void;
  onCreate: (body: CreateAutomationInput) => Promise<void>;
  onUpdate: (automationId: string, body: UpdateAutomationInput) => Promise<void>;
}

export function AutomationEditorModal({
  open,
  automation,
  busy,
  initialOwnerScope,
  organizationId,
  organizationName = null,
  canManageTeamAutomations,
  onClose,
  onConfigureCloudTarget,
  onCreate,
  onUpdate,
}: AutomationEditorModalProps) {
  const [title, setTitle] = useState(automation?.title ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [targetOverride, setTargetOverride] = useState<AutomationTargetSelection | null>(null);
  const [draftOwnerScope, setDraftOwnerScope] = useState<AutomationOwnerScope>(
    automation?.ownerScope ?? initialOwnerScope,
  );
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetValue>(
    automation ? presetForRrule(automation.schedule.rrule) : "daily",
  );
  const [rrule, setRrule] = useState(
    automation?.schedule.rrule ?? rruleForPresetAtTime("daily"),
  );
  const [timezone, setTimezone] = useState(
    automation?.schedule.timezone ?? defaultAutomationTimezone(),
  );
  const [cloudAgentRunConfigId, setCloudAgentRunConfigId] = useState<string | null>(
    automation?.cloudAgentRunConfigId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingConfigureTarget, setPendingConfigureTarget] = useState<{
    gitOwner: string;
    gitRepoName: string;
  } | null>(null);

  const targetSelection = useAutomationTargetSelection({
    automation,
    selectedTarget: targetOverride,
    enabled: open,
  });
  const ownerScope = automation?.ownerScope ?? draftOwnerScope;
  const isTeamAutomation = ownerScope === "organization";
  const effectiveOrganizationId = isTeamAutomation ? organizationId : null;
  const selectedTarget = targetSelection.selectedTarget;
  const targetMode: AutomationTargetMode = isTeamAutomation
    ? "shared_cloud"
    : selectedTarget?.executionTarget === "local"
      ? "local"
      : "personal_cloud";
  const runConfigsQuery = useAgentRunConfigs({
    ownerScope: isTeamAutomation ? undefined : ownerScope,
    organizationId: effectiveOrganizationId,
    usableIn: isTeamAutomation ? "shared_sandboxes" : "personal_sandboxes",
    status: "active",
  }, open && (!isTeamAutomation || effectiveOrganizationId !== null));
  const runConfigs = (runConfigsQuery.data?.configs ?? []).filter((config) =>
    !isTeamAutomation || config.ownerScope !== "personal"
  );
  const ownerOptions = useMemo(() => [
    {
      value: "personal" as const,
      label: "Personal",
      description: "Run with your local or personal cloud setup.",
    },
    {
      value: "organization" as const,
      label: "Team",
      description: organizationName
        ? `Run in ${organizationName}'s shared cloud sandbox.`
        : "Run in the shared cloud sandbox.",
      disabledReason: !organizationId
        ? "Select an organization first."
        : !canManageTeamAutomations
          ? "Only organization admins can create team automations."
          : null,
    },
  ], [canManageTeamAutomations, organizationId, organizationName]);
  const teamTargetGroups = useMemo(() => targetSelection.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        row.kind === "configureCloud" || row.target.executionTarget === "cloud"
      ),
    }))
    .filter((group) => group.rows.length > 0), [targetSelection.groups]);
  const targetDisabledReason = isTeamAutomation
    ? "Select a configured cloud workspace for team automation."
    : targetSelection.disabledReason;
  const canSubmitTarget = targetSelection.canSubmit
    && (!isTeamAutomation || selectedTarget?.executionTarget === "cloud");

  useEffect(() => {
    if (!cloudAgentRunConfigId || runConfigsQuery.isLoading) {
      return;
    }
    if (!runConfigs.some((config) => config.id === cloudAgentRunConfigId)) {
      setCloudAgentRunConfigId(null);
    }
  }, [cloudAgentRunConfigId, runConfigs, runConfigsQuery.isLoading]);

  const submit = async () => {
    setError(null);
    if (!title.trim() || !prompt.trim()) {
      setError("Add a title and prompt before saving.");
      return;
    }
    if (isTeamAutomation && !effectiveOrganizationId) {
      setError("Select an organization before creating a team automation.");
      return;
    }
    if (isTeamAutomation && !canManageTeamAutomations) {
      setError("Only organization admins can create team automations.");
      return;
    }
    if (!canSubmitTarget || !selectedTarget) {
      setError(targetDisabledReason ?? "Select a target before saving.");
      return;
    }
    if (!cloudAgentRunConfigId) {
      setError("Choose an agent run config before saving.");
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
    try {
      if (automation) {
        await onUpdate(automation.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          schedule,
          targetMode,
          cloudAgentRunConfigId,
        });
      } else {
        await onCreate({
          title: title.trim(),
          prompt: prompt.trim(),
          gitOwner: selectedTarget.gitOwner,
          gitRepoName: selectedTarget.gitRepoName,
          schedule,
          ownerScope,
          organizationId: effectiveOrganizationId,
          targetMode,
          cloudAgentRunConfigId,
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

  const hasDraftChanges = () => {
    const initialRrule = automation?.schedule.rrule ?? rruleForPresetAtTime("daily");
    const initialTimezone = automation?.schedule.timezone ?? defaultAutomationTimezone();
    return title.trim() !== (automation?.title ?? "").trim()
      || prompt.trim() !== (automation?.prompt ?? "").trim()
      || rrule.trim() !== initialRrule.trim()
      || timezone.trim() !== initialTimezone.trim()
      || targetOverride !== null
      || draftOwnerScope !== (automation?.ownerScope ?? initialOwnerScope)
      || cloudAgentRunConfigId !== (automation?.cloudAgentRunConfigId ?? null);
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

  const handleOwnerScopeSelect = (nextOwnerScope: AutomationOwnerScope) => {
    setDraftOwnerScope(nextOwnerScope);
    setCloudAgentRunConfigId(null);
    setError(null);
    if (nextOwnerScope === "organization" && targetOverride?.executionTarget === "local") {
      setTargetOverride(null);
    }
  };

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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            <Textarea
              id="automation-prompt"
              variant="ghost"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Prompt"
              placeholder="Add prompt e.g. look for crashes in $sentry"
              className="min-h-[16rem] px-0 text-base leading-relaxed placeholder:text-muted-foreground"
            />
            <AutomationRunLocationSelector
              ownerScope={ownerScope}
              canChangeOwner={!automation}
              ownerOptions={ownerOptions}
              personalGroups={targetSelection.groups}
              teamGroups={teamTargetGroups}
              isLoading={targetSelection.isLoading}
              disabledReason={targetSelection.disabledReason}
              onSelectOwner={handleOwnerScopeSelect}
              onSelectTarget={setTargetOverride}
              onConfigureCloud={handleConfigureCloudTarget}
            />
          </div>
          <div className="shrink-0 pt-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <AutomationSchedulePopover
                  schedulePreset={schedulePreset}
                  rrule={rrule}
                  timezone={timezone}
                  onSchedulePresetChange={setSchedulePreset}
                  onRruleChange={handleRruleChange}
                  onTimezoneChange={setTimezone}
                  onRruleBlur={() => setError(validateAutomationRrule(rrule))}
                />
                <AutomationAgentRunConfigPicker
                  configs={runConfigs}
                  selectedConfigId={cloudAgentRunConfigId}
                  isLoading={runConfigsQuery.isLoading}
                  disabledReason={isTeamAutomation
                    ? "No shared team agent configs"
                    : "No agent run configs"}
                  onSelect={(config) => setCloudAgentRunConfigId(config?.id ?? null)}
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
                    (!automation && (runConfigsQuery.isLoading || targetSelection.isLoading))
                    || !cloudAgentRunConfigId
                    || !canSubmitTarget
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
