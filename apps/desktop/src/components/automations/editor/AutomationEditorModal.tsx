import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { AgentHarnessModelSelector } from "@/components/agents/AgentHarnessModelSelector";
import { SessionConfigControls } from "@/components/workspace/chat/input/SessionConfigControls";
import { useAutomationTargetSelection } from "@/hooks/automations/derived/use-automation-target-selection";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentRunConfigMutations } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-config-mutations";
import type { AutomationTargetSelection } from "@/lib/domain/automations/target/selection";
import type {
  AutomationRecord,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/domain/automations/run/ui-records";
import type {
  AutomationOwnerScope,
  AutomationTargetMode,
} from "@/lib/domain/automations/run/types";
import {
  buildLaunchControlDescriptors,
} from "@/lib/domain/chat/models/launch-control-descriptors";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
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
  onConfigureCloudTarget: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => void;
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
  const [agentKind, setAgentKind] = useState<string | null>(
    automation?.agentKind ?? null,
  );
  const [modelId, setModelId] = useState<string | null>(
    automation?.modelId ?? null,
  );
  const [agentControlValues, setAgentControlValues] = useState<Record<string, string>>(
    () => initialAutomationControlValues(automation),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingConfigureTarget, setPendingConfigureTarget] = useState<{
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  } | null>(null);

  const ownerScope = automation?.ownerScope ?? draftOwnerScope;
  const isTeamAutomation = ownerScope === "organization";
  const personalTargetSelection = useAutomationTargetSelection({
    automation: automation?.ownerScope === "personal" ? automation : null,
    selectedTarget: ownerScope === "personal" ? targetOverride : null,
    ownerScope: "personal",
    enabled: open && (!automation || automation.ownerScope === "personal"),
  });
  const teamTargetSelection = useAutomationTargetSelection({
    automation: automation?.ownerScope === "organization" ? automation : null,
    selectedTarget: ownerScope === "organization" ? targetOverride : null,
    ownerScope: "organization",
    organizationId,
    enabled: open
      && canManageTeamAutomations
      && organizationId !== null
      && (!automation || automation.ownerScope === "organization"),
  });
  const activeTargetSelection = isTeamAutomation ? teamTargetSelection : personalTargetSelection;
  const effectiveOrganizationId = isTeamAutomation ? organizationId : null;
  const selectedTarget = activeTargetSelection.selectedTarget;
  const targetMode: AutomationTargetMode = isTeamAutomation
    ? "shared_cloud"
    : selectedTarget?.executionTarget === "local"
      ? "local"
      : "personal_cloud";
  const cloudAgentCatalogQuery = useCloudAgentCatalog(open);
  const agentRunConfigMutations = useAgentRunConfigMutations();
  const launchAgents = cloudAgentCatalogQuery.data?.agents ?? [];
  const selectedAgent = useMemo(
    () => resolveAutomationAgent(launchAgents, agentKind),
    [agentKind, launchAgents],
  );
  const selectedModel = useMemo(
    () => resolveAutomationModel(selectedAgent, modelId),
    [modelId, selectedAgent],
  );
  const effectiveAgentKind = selectedAgent?.kind ?? null;
  const effectiveModelId = selectedModel?.id ?? null;
  const agentControlDescriptors = useMemo(
    () => selectedAgent && effectiveModelId
      ? buildLaunchControlDescriptors({
        selection: { kind: selectedAgent.kind, modelId: effectiveModelId },
        launchAgents: [selectedAgent],
        pendingConfigChanges: null,
        preferences: {
          defaultSessionModeByAgentKind: agentControlValues.mode
            ? { [selectedAgent.kind]: agentControlValues.mode }
            : {},
          defaultLiveSessionControlValuesByAgentKind: {
            [selectedAgent.kind]: agentControlValues,
          },
        },
        onSelect: (
          _agentKind: string,
          _controlKey: SupportedLiveControlKey,
          rawConfigId: string,
          value: string,
        ) => {
          setAgentControlValues((current) => ({
            ...current,
            [rawConfigId]: value,
          }));
        },
      })
      : [],
    [agentControlValues, effectiveModelId, selectedAgent],
  );
  const selectedAgentControlValues = useMemo(
    () => selectedControlValues(agentControlDescriptors),
    [agentControlDescriptors],
  );
  const agentSelectionReady = Boolean(effectiveAgentKind && effectiveModelId);
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
  const teamTargetGroups = useMemo(() => teamTargetSelection.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        row.kind === "configureCloud"
        || row.target.executionTarget === "cloud"
        || row.target.executionTarget === "ssh"
      ),
    }))
    .filter((group) => group.rows.length > 0), [teamTargetSelection.groups]);
  const targetDisabledReason = isTeamAutomation
    ? "Select a configured cloud workspace for team automation."
    : activeTargetSelection.disabledReason;
  const canSubmitTarget = activeTargetSelection.canSubmit
    && (!isTeamAutomation || selectedTarget?.executionTarget !== "local");
  const targetSelectionLoading = personalTargetSelection.isLoading
    || teamTargetSelection.isLoading;

  useEffect(() => {
    if (!open || launchAgents.length === 0) {
      return;
    }
    const resolvedAgent = resolveAutomationAgent(launchAgents, agentKind);
    if (resolvedAgent && resolvedAgent.kind !== agentKind) {
      setAgentKind(resolvedAgent.kind);
    }
    const resolvedModel = resolveAutomationModel(resolvedAgent, modelId);
    if (resolvedModel && resolvedModel.id !== modelId) {
      setModelId(resolvedModel.id);
    }
  }, [agentKind, launchAgents, modelId, open]);

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
    if (!effectiveAgentKind || !effectiveModelId) {
      setError("Choose an agent harness before saving.");
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
    let createdRunConfigId: string | null = null;
    try {
      const runConfig = await agentRunConfigMutations.createMutation.mutateAsync({
        name: automationRunConfigName(title),
        ownerScope,
        organizationId: effectiveOrganizationId,
        agentKind: effectiveAgentKind,
        modelId: effectiveModelId,
        controlValues: selectedAgentControlValues,
        usableInPersonalSandboxes: !isTeamAutomation,
        usableInSharedSandboxes: isTeamAutomation,
      });
      createdRunConfigId = runConfig.id;
      if (automation) {
        await onUpdate(automation.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          schedule,
          targetMode,
          cloudAgentRunConfigId: runConfig.id,
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
          cloudAgentRunConfigId: runConfig.id,
        });
      }
      onClose();
    } catch (caught) {
      if (createdRunConfigId) {
        await agentRunConfigMutations.deleteMutation.mutateAsync(createdRunConfigId)
          .catch(() => undefined);
      }
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
      || effectiveAgentKind !== (automation?.agentKind ?? null)
      || effectiveModelId !== (automation?.modelId ?? null)
      || !controlValuesEqual(
        selectedAgentControlValues,
        initialAutomationControlValues(automation),
      );
  };

  const handleConfigureCloudTarget = (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => {
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
    if (nextOwnerScope === ownerScope) {
      return;
    }
    setDraftOwnerScope(nextOwnerScope);
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
            <AutomationRunLocationSelector
              ownerScope={ownerScope}
              canChangeOwner={!automation}
              ownerOptions={ownerOptions}
              personalGroups={personalTargetSelection.groups}
              teamGroups={teamTargetGroups}
              isLoading={targetSelectionLoading}
              disabledReason={activeTargetSelection.disabledReason}
              onSelectOwner={handleOwnerScopeSelect}
              onSelectTarget={setTargetOverride}
              onConfigureCloud={handleConfigureCloudTarget}
            />
            <Textarea
              id="automation-prompt"
              variant="ghost"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Prompt"
              placeholder="Add prompt e.g. look for crashes in $sentry"
              className="min-h-[12rem] px-0 text-base leading-relaxed placeholder:text-muted-foreground"
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
                <AutomationAgentHarnessControls
                  agents={launchAgents}
                  selectedAgent={selectedAgent}
                  selectedModel={selectedModel}
                  controls={agentControlDescriptors}
                  loading={cloudAgentCatalogQuery.isLoading}
                  onSelectModel={(nextAgent, nextModel) => {
                    setAgentKind(nextAgent.kind);
                    setModelId(nextModel.id);
                    setAgentControlValues({});
                  }}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={busy || agentRunConfigMutations.createMutation.isPending}
                  disabled={
                    (!automation && (cloudAgentCatalogQuery.isLoading || targetSelectionLoading))
                    || agentRunConfigMutations.createMutation.isPending
                    || !agentSelectionReady
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

function AutomationAgentHarnessControls({
  agents,
  selectedAgent,
  selectedModel,
  controls,
  loading,
  onSelectModel,
}: {
  agents: DesktopAgentLaunchAgent[];
  selectedAgent: DesktopAgentLaunchAgent | null;
  selectedModel: DesktopAgentLaunchModel | null;
  controls: LiveSessionControlDescriptor[];
  loading: boolean;
  onSelectModel: (agent: DesktopAgentLaunchAgent, model: DesktopAgentLaunchModel) => void;
}) {
  const label = selectedAgent && selectedModel
    ? `${selectedAgent.displayName} · ${selectedModel.displayName}`
    : loading
      ? "Loading agents"
      : "Agent harness";

  return (
    <>
      <AgentHarnessModelSelector
        label={label}
        agentKind={selectedAgent?.kind ?? null}
        selectedModelId={selectedModel?.id ?? null}
        disabled={loading || agents.length === 0}
        className="max-w-[16rem]"
        menuClassName="w-80"
        modelGroups={agents.map((agent) => ({
          agentKind: agent.kind,
          agentDisplayName: agent.displayName,
          models: agent.models.map((model) => ({
            id: model.id,
            label: model.displayName,
            detail: agent.displayName,
          })),
        })).filter((group) => group.models.length > 0)}
        onSelectModel={(nextAgentKind, nextModelId) => {
          const nextAgent = agents.find((agent) => agent.kind === nextAgentKind) ?? null;
          const nextModel = nextAgent?.models.find((model) => model.id === nextModelId) ?? null;
          if (nextAgent && nextModel) {
            onSelectModel(nextAgent, nextModel);
          }
        }}
      />
      <SessionConfigControls
        agentKind={selectedAgent?.kind ?? null}
        controls={controls}
      />
    </>
  );
}

function resolveAutomationAgent(
  agents: DesktopAgentLaunchAgent[],
  agentKind: string | null,
): DesktopAgentLaunchAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.models.length > 0)
    ?? null;
}

function resolveAutomationModel(
  agent: DesktopAgentLaunchAgent | null,
  modelId: string | null,
): DesktopAgentLaunchModel | null {
  if (!agent) {
    return null;
  }
  return agent.models.find((model) => model.id === modelId)
    ?? agent.models.find((model) => model.id === agent.defaultModelId)
    ?? agent.models.find((model) => model.isDefault)
    ?? agent.models[0]
    ?? null;
}

function selectedControlValues(
  controls: LiveSessionControlDescriptor[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const selected = control.options.find((option) => option.selected);
    if (selected?.value) {
      values[control.rawConfigId] = selected.value;
    }
  }
  return values;
}

function initialAutomationControlValues(
  automation: AutomationRecord | null,
): Record<string, string> {
  return {
    ...(automation?.modeId ? { mode: automation.modeId } : {}),
    ...(automation?.reasoningEffort ? { effort: automation.reasoningEffort } : {}),
  };
}

function controlValuesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => value.trim().length > 0);
  const rightEntries = Object.entries(right).filter(([, value]) => value.trim().length > 0);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right[key] === value);
}

function automationRunConfigName(title: string): string {
  const trimmed = title.trim();
  return `Automation · ${trimmed ? trimmed.slice(0, 80) : "Untitled"}`;
}
