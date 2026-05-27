import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  AutomationResponse,
  AutomationRunResponse,
  CloudRepoConfigSummary,
  CreateAutomationRequest,
} from "@proliferate/cloud-sdk";
import {
  useAgentRunConfigActions,
  useAgentAuthCredentials,
  useAutomationActions,
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudRepoConfigs,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";
import {
  buildAutomationCalendarWeek,
  buildAutomationInventoryItems,
  buildAutomationRunInventoryItems,
  groupAutomationInventoryItems,
  type AutomationSurfaceViewMode,
} from "@proliferate/product-model/automations/inventory";
import type {
  AutomationSchedulePreset,
} from "@proliferate/product-model/automations/schedule";
import {
  AUTOMATION_SCHEDULE_PRESETS,
  automationTimezoneOptions,
  defaultAutomationTimezone,
  rruleForPresetAtTime,
  schedulePresetAcceptsTime,
  validateAutomationRrule,
  validateAutomationTimezone,
} from "@proliferate/product-model/automations/schedule";
import {
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-model/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-model/chats/cloud/harness-availability";
import {
  AutomationCreatePanel,
  type AutomationCreateFormValues,
  type AutomationCreateOption,
} from "@proliferate/product-ui/automations/AutomationCreatePanel";
import { AutomationDetailSurface } from "@proliferate/product-ui/automations/AutomationDetailSurface";
import { AutomationSurface } from "@proliferate/product-ui/automations/AutomationSurface";

import { routes } from "../../../config/routes";

const EMPTY_AUTOMATIONS: AutomationResponse[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunResponse[] = [];
const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];
const PERSONAL_OWNER_KEY = "personal";
const DEFAULT_SCHEDULE_PRESET: AutomationSchedulePreset = "daily";
const SCHEDULE_OPTIONS: AutomationCreateOption[] = AUTOMATION_SCHEDULE_PRESETS.map((option) => ({
  value: option.value,
  label: option.label,
}));

interface AutomationsScreenProps {
  selectedAutomationId?: string | null;
}

export function AutomationsScreen({ selectedAutomationId = null }: AutomationsScreenProps) {
  const navigate = useNavigate();
  const personalAutomations = useAutomations({
    ownerScope: "personal",
    organizationId: null,
  });
  const organizations = useOrganizations();
  const adminOrganizations = useMemo(() => {
    const organizationsList = organizations.data?.organizations ?? [];
    return organizationsList.filter((organization) => {
      const role = organization.membership?.role;
      return organization.membership?.status === "active" && (role === "owner" || role === "admin");
    });
  }, [organizations.data?.organizations]);
  const teamOrganizationId = adminOrganizations[0]?.id ?? null;
  const teamAutomations = useAutomations({
    ownerScope: "organization",
    organizationId: teamOrganizationId,
    enabled: teamOrganizationId !== null,
  });
  const repoConfigs = useCloudRepoConfigs();
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const actions = useAutomationActions();
  const runConfigActions = useAgentRunConfigActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [createValues, setCreateValues] = useState(createInitialFormValues);
  const [surfaceMode, setSurfaceMode] = useState<AutomationSurfaceViewMode>("list");
  const [includePausedCalendar, setIncludePausedCalendar] = useState(false);
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingCloudWorkspaceId, setPendingCloudWorkspaceId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<{
    automationId: string;
    action: "pause" | "resume" | "run";
  } | null>(null);

  const automations = useMemo(() => {
    const combined = [
      ...(personalAutomations.data?.automations ?? EMPTY_AUTOMATIONS),
      ...(teamAutomations.data?.automations ?? EMPTY_AUTOMATIONS),
    ];
    return [...combined].sort((left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  }, [personalAutomations.data?.automations, teamAutomations.data?.automations]);
  const automationsLoading = personalAutomations.isLoading
    || (teamOrganizationId !== null && teamAutomations.isLoading);
  const automationsError = Boolean(personalAutomations.error)
    || (teamOrganizationId !== null && Boolean(teamAutomations.error));
  const hasAutomationLoadError = automationsError && automations.length === 0;
  const partialAutomationLoadError = automationsError && automations.length > 0
    ? "Some automations could not load. The list may be incomplete."
    : null;

  const selectedFromList = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId) ?? null,
    [automations, selectedAutomationId],
  );
  const selectedDetail = useAutomationDetail(
    selectedFromList ? null : selectedAutomationId,
    selectedAutomationId !== null && selectedFromList === null,
  );
  const selectedAutomation = selectedFromList ?? selectedDetail.data ?? null;
  const automationKnown = selectedFromList !== null || selectedDetail.data !== undefined;
  const runs = useAutomationRuns(selectedAutomationId, selectedAutomationId !== null && automationKnown);
  const runRecords = runs.data?.runs ?? EMPTY_AUTOMATION_RUNS;
  const runById = useMemo(
    () => new Map(runRecords.map((run) => [run.id, run])),
    [runRecords],
  );

  const automationItems = useMemo(
    () => buildAutomationInventoryItems(automations, { clientSurface: "web" }),
    [automations],
  );
  const automationGroups = useMemo(
    () => groupAutomationInventoryItems(automationItems),
    [automationItems],
  );
  const calendarDays = useMemo(
    () => buildAutomationCalendarWeek(automations, {
      clientSurface: "web",
      includePaused: includePausedCalendar,
    }),
    [automations, includePausedCalendar],
  );
  const selectedAutomationItem = useMemo(
    () => selectedAutomation
      ? buildAutomationInventoryItems([selectedAutomation], { clientSurface: "web" })[0] ?? null
      : null,
    [selectedAutomation],
  );
  const runItems = useMemo(
    () => buildAutomationRunInventoryItems(runRecords, {
      clientSurface: "web",
      pendingCloudWorkspaceId,
    }),
    [pendingCloudWorkspaceId, runRecords],
  );

  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? EMPTY_REPO_CONFIGS),
    [repoConfigs.data?.configs],
  );
  const agentGateway = cloudCapabilities.data?.agentGateway;
  const readySyncedAgentKinds = useMemo(
    () => readySyncedCloudAgentKinds(agentAuthCredentials.data),
    [agentAuthCredentials.data],
  );
  const readySyncedAgentKindsKey = readySyncedAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog.data?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const harnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog.data?.agents.map((agent) => agent.kind),
    readyAgentKinds: readySyncedAgentKinds,
    agentGateway,
  }), [
    agentCatalog.data,
    readySyncedAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
  ]);
  const launchableAgentKinds = harnessAvailability.launchableAgentKinds;
  const canStartCloudHarness = launchableAgentKinds.length > 0;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection, launchableAgentKinds],
  );
  const agentControls = useMemo(
    () => buildCloudLaunchComposerControls({
      catalog: agentCatalog.data,
      launchableAgentKinds,
      selection: resolvedLaunchSelection,
      onAgentModelSelect: (agentKind, modelId) => {
        setLaunchSelection((current) => ({
          agentKind,
          modelId,
          modeId: current.agentKind === agentKind ? current.modeId : null,
          controlValues: current.agentKind === agentKind ? current.controlValues : {},
        }));
      },
      onControlSelect: ({ controlKey, value }) => {
        setLaunchSelection((current) => {
          if (controlKey === "mode") {
            return { ...current, modeId: value };
          }
          return {
            ...current,
            controlValues: {
              ...current.controlValues,
              [controlKey]: value,
            },
          };
        });
      },
    }),
    [agentCatalog.data, launchableAgentKinds, resolvedLaunchSelection],
  );
  const timezoneOptions = useMemo(
    () => automationTimezoneOptions(createValues.timezone),
    [createValues.timezone],
  );

  useEffect(() => {
    if (!createOpen) {
      return;
    }
    setCreateValues((current) => {
      const repoStillAvailable = repoOptions.some((option) =>
        option.value === current.repoKey && !option.disabled
      );
      const nextRepoKey = repoStillAvailable
        ? current.repoKey
        : repoOptions.find((option) => !option.disabled)?.value ?? "";

      if (nextRepoKey === current.repoKey) {
        return current;
      }
      return {
        ...current,
        repoKey: nextRepoKey,
      };
    });
  }, [createOpen, repoOptions]);

  async function submitCreate() {
    setCreateError(null);
    setActionError(null);
    if (optionsUnavailable) {
      setCreateError(optionLoadError ?? "Automation options are still loading.");
      return;
    }
    if (!canStartCloudHarness) {
      setCreateError(
        harnessAvailability.message ?? "No cloud agent is ready to create this automation.",
      );
      return;
    }
    const title = createValues.title.trim();
    const prompt = createValues.prompt.trim();
    if (!title || !prompt) {
      setCreateError("Add a title and prompt before creating the automation.");
      return;
    }

    const repoIdentity = parseRepoKey(createValues.repoKey);
    const selectedRepo = repoConfigs.data?.configs.find((repo) =>
      repoIdentity
      && repo.gitOwner === repoIdentity.gitOwner
      && repo.gitRepoName === repoIdentity.gitRepoName
    );
    if (!repoIdentity || !selectedRepo?.configured) {
      setCreateError("Choose a configured repo before creating the automation.");
      return;
    }

    if (!resolvedLaunchSelection.agentKind || !resolvedLaunchSelection.modelId) {
      setCreateError("Choose an agent and model before creating the automation.");
      return;
    }

    const schedulePreset = parseSchedulePreset(createValues.schedulePreset);
    if (!schedulePreset) {
      setCreateError("Choose a supported schedule.");
      return;
    }

    const schedule = {
      rrule: rruleForPresetAtTime(schedulePreset, createValues.scheduleTime),
      timezone: createValues.timezone.trim(),
    };
    const scheduleError = validateAutomationRrule(schedule.rrule)
      ?? validateAutomationTimezone(schedule.timezone);
    if (scheduleError) {
      setCreateError(scheduleError);
      return;
    }

    const runConfigName = `${title} agent`;
    const runConfig = {
      name: runConfigName,
      ownerScope: "personal" as const,
      organizationId: null,
      agentKind: resolvedLaunchSelection.agentKind,
      modelId: resolvedLaunchSelection.modelId,
      controlValues: buildLaunchRunConfigControlValues({
        catalog: agentCatalog.data,
        launchableAgentKinds,
        selection: resolvedLaunchSelection,
      }),
      usableInPersonalSandboxes: true,
      usableInSharedSandboxes: false,
    };

    const bodyBase: Omit<CreateAutomationRequest, "cloudAgentRunConfigId"> = {
      title,
      prompt,
      ownerScope: "personal",
      organizationId: null,
      gitOwner: repoIdentity.gitOwner,
      gitRepoName: repoIdentity.gitRepoName,
      schedule,
      targetMode: "personal_cloud",
    };

    let createdRunConfigId: string | null = null;
    try {
      const createdRunConfig = await runConfigActions.createAgentRunConfig(runConfig);
      createdRunConfigId = createdRunConfig.id;
      const created = await actions.createAutomation({
        ...bodyBase,
        cloudAgentRunConfigId: createdRunConfig.id,
      });
      setCreateValues(createInitialFormValues());
      setCreateOpen(false);
      navigate(`/automations/${created.id}`);
    } catch (error) {
      if (createdRunConfigId) {
        void runConfigActions.deleteAgentRunConfig(createdRunConfigId).catch(() => undefined);
      }
      setCreateError(error instanceof Error ? error.message : "Automation could not be created.");
    }
  }

  async function runAutomationAction(
    automationId: string,
    action: "pause" | "resume" | "run",
  ) {
    setActionError(null);
    setBusyAction({ automationId, action });
    try {
      if (action === "pause") {
        await actions.pauseAutomation(automationId);
      } else if (action === "resume") {
        await actions.resumeAutomation(automationId);
      } else {
        await actions.runAutomationNow(automationId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Automation action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function openRun(runId: string) {
    const run = runById.get(runId);
    if (!run?.cloudWorkspaceId) {
      return;
    }
    setPendingCloudWorkspaceId(run.cloudWorkspaceId);
    navigate(run.anyharnessSessionId
      ? routes.chat(run.cloudWorkspaceId, run.anyharnessSessionId)
      : routes.workspace(run.cloudWorkspaceId));
    window.setTimeout(() => setPendingCloudWorkspaceId(null), 0);
  }

  const optionLoadError = repoConfigs.error || agentCatalog.error
    ? "Could not load repo or agent options. Retry from the page or refresh."
    : !canStartCloudHarness && harnessAvailability.message
      ? harnessAvailability.message
    : null;
  const optionsUnavailable = repoConfigs.isLoading
    || agentCatalog.isLoading
    || Boolean(repoConfigs.error)
    || Boolean(agentCatalog.error)
    || !canStartCloudHarness;
  const submitting = actions.creatingAutomation || runConfigActions.creatingAgentRunConfig;
  const busy = actions.creatingAutomation
    || actions.updatingAutomation
    || actions.pausingAutomation
    || actions.resumingAutomation
    || actions.runningAutomationNow;

  if (selectedAutomationId) {
    return (
      <AutomationDetailSurface
        automation={selectedAutomationItem}
        runs={runItems}
        loadingAutomation={selectedDetail.isLoading}
        loadingRuns={selectedDetail.isLoading || runs.isLoading}
        notFound={Boolean(selectedDetail.error)}
        actionError={actionError}
        busy={busy || busyAction !== null}
        onBack={() => navigate(routes.automations)}
        onRunNow={(automationId) => void runAutomationAction(automationId, "run")}
        onPause={(automationId) => void runAutomationAction(automationId, "pause")}
        onResume={(automationId) => void runAutomationAction(automationId, "resume")}
        onRunSelect={openRun}
      />
    );
  }

  return (
    <>
      {createOpen ? (
        <div className="mx-auto mb-4 max-w-none px-8 pt-8">
          <AutomationCreatePanel
            values={createValues}
            ownerOptions={[{ value: PERSONAL_OWNER_KEY, label: "Personal" }]}
            repoOptions={repoOptions}
            scheduleOptions={SCHEDULE_OPTIONS}
            timezoneOptions={timezoneOptions}
            agentControls={agentControls}
            loadingOptions={repoConfigs.isLoading || agentCatalog.isLoading}
            submitting={submitting}
            submitDisabled={optionsUnavailable}
            error={createError ?? optionLoadError}
            timeDisabled={!schedulePresetAcceptsTime(
              parseSchedulePreset(createValues.schedulePreset) ?? "custom",
            )}
            onChange={(values) => setCreateValues(values)}
            onSubmit={() => void submitCreate()}
            onCancel={() => {
              setCreateError(null);
              setCreateOpen(false);
            }}
          />
        </div>
      ) : null}
      <AutomationSurface
        mode={surfaceMode}
        groups={automationGroups}
        calendarDays={calendarDays}
        includePaused={includePausedCalendar}
        description="Create scheduled work against configured cloud repositories."
        loading={automationsLoading}
        error={hasAutomationLoadError}
        actionError={actionError ?? partialAutomationLoadError}
        busyAutomationId={busyAction?.automationId ?? null}
        busyAction={busyAction?.action ?? null}
        actionsDisabled={busy || busyAction !== null}
        maxWidthClassName="max-w-none"
        onModeChange={setSurfaceMode}
        onIncludePausedChange={setIncludePausedCalendar}
        onNew={() => {
          setCreateError(null);
          setCreateOpen(true);
        }}
        onRetry={() => {
          void personalAutomations.refetch();
          if (teamOrganizationId !== null) {
            void teamAutomations.refetch();
          }
        }}
        onAutomationSelect={(automationId) => navigate(`/automations/${automationId}`)}
        onPause={(automationId) => void runAutomationAction(automationId, "pause")}
        onResume={(automationId) => void runAutomationAction(automationId, "resume")}
        onRunNow={(automationId) => void runAutomationAction(automationId, "run")}
      />
    </>
  );
}

function createInitialFormValues(): AutomationCreateFormValues {
  return {
    title: "",
    prompt: "",
    ownerKey: PERSONAL_OWNER_KEY,
    repoKey: "",
    schedulePreset: DEFAULT_SCHEDULE_PRESET,
    scheduleTime: "09:00",
    timezone: defaultAutomationTimezone(),
  };
}

function buildRepoOptions(configs: CloudRepoConfigSummary[]): AutomationCreateOption[] {
  return configs.map((config) => ({
    value: repoKey(config.gitOwner, config.gitRepoName),
    label: `${config.gitOwner}/${config.gitRepoName}${config.configured ? "" : " (not configured)"}`,
    disabled: !config.configured,
  }));
}

function repoKey(gitOwner: string, gitRepoName: string): string {
  return `${gitOwner}/${gitRepoName}`;
}

function parseRepoKey(value: string): { gitOwner: string; gitRepoName: string } | null {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }
  return {
    gitOwner: value.slice(0, separatorIndex),
    gitRepoName: value.slice(separatorIndex + 1),
  };
}

function parseSchedulePreset(value: string): AutomationSchedulePreset | null {
  const preset = AUTOMATION_SCHEDULE_PRESETS.find((option) => option.value === value);
  return preset?.value ?? null;
}
