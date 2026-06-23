import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAutomationTargetSelection } from "@/hooks/automations/derived/use-automation-target-selection";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentRunConfigMutations } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-config-mutations";
import type { AutomationTargetSelection } from "@/lib/domain/automations/target/selection";
import type { AutomationRecord, CreateAutomationInput, UpdateAutomationInput } from "@/lib/domain/automations/run/ui-records";
import type {
  AutomationOwnerScope,
  AutomationTargetMode,
} from "@/lib/domain/automations/run/types";
import { buildLaunchControlDescriptors } from "@/lib/domain/chat/models/launch-control-descriptors";
import type { SupportedLiveControlKey } from "@/lib/domain/chat/session-controls/session-controls";
import {
  automationControlValuesEqual,
  automationRunConfigName,
  initialAutomationControlValues,
  resolveAutomationAgent,
  resolveAutomationModel,
  selectedAutomationControlValues,
} from "@/lib/domain/automations/editor/run-config";
import {
  defaultAutomationTimezone,
  presetForRrule,
  rruleForPresetAtTime,
  validateAutomationRrule,
  validateAutomationTimezone,
} from "@/lib/domain/automations/schedule/schedule";
import { AutomationEditorDialog } from "@/components/automations/editor/AutomationEditorDialog";

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
  const [schedulePreset, setSchedulePreset] = useState(
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
    () => selectedAutomationControlValues(agentControlDescriptors),
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
        ? `Run with ${organizationName}'s organization cloud setup.`
        : "Run with the organization's cloud setup.",
      disabledReason: !organizationId
        ? "Select an organization first."
        : !canManageTeamAutomations
          ? "Only organization admins can create team workflows."
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
    ? "Select a configured cloud workspace for team workflow."
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
      setError("Select an organization before creating a team workflow.");
      return;
    }
    if (isTeamAutomation && !canManageTeamAutomations) {
      setError("Only organization admins can create team workflows.");
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
      setError(caught instanceof Error ? caught.message : "Failed to save workflow.");
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
      || !automationControlValuesEqual(
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
    <AutomationEditorDialog
      open={open}
      automation={automation}
      busy={busy}
      error={error}
      title={title}
      prompt={prompt}
      ownerScope={ownerScope}
      ownerOptions={ownerOptions}
      personalGroups={personalTargetSelection.groups}
      teamGroups={teamTargetGroups}
      targetSelectionLoading={targetSelectionLoading}
      targetDisabledReason={activeTargetSelection.disabledReason}
      schedulePreset={schedulePreset}
      rrule={rrule}
      timezone={timezone}
      agents={launchAgents}
      selectedAgent={selectedAgent}
      selectedModel={selectedModel}
      controls={agentControlDescriptors}
      agentsLoading={cloudAgentCatalogQuery.isLoading}
      savingRunConfig={agentRunConfigMutations.createMutation.isPending}
      agentSelectionReady={agentSelectionReady}
      canSubmitTarget={canSubmitTarget}
      pendingConfigureTarget={pendingConfigureTarget}
      onClose={onClose}
      onSubmit={handleSubmit}
      onTitleChange={setTitle}
      onPromptChange={setPrompt}
      onSelectOwner={handleOwnerScopeSelect}
      onSelectTarget={setTargetOverride}
      onConfigureCloudTarget={handleConfigureCloudTarget}
      onSchedulePresetChange={setSchedulePreset}
      onRruleChange={handleRruleChange}
      onTimezoneChange={setTimezone}
      onRruleBlur={() => setError(validateAutomationRrule(rrule))}
      onSelectModel={(nextAgent, nextModel) => {
        setAgentKind(nextAgent.kind);
        setModelId(nextModel.id);
        setAgentControlValues({});
      }}
      onCancelConfigureTarget={() => setPendingConfigureTarget(null)}
      onConfirmConfigureTarget={handleConfirmConfigureCloudTarget}
    />
  );
}
