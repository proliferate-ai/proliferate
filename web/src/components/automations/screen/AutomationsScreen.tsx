import { useEffect, useMemo, useState } from "react";

import type {
  AutomationSchedulePreset,
} from "@proliferate/product-model/automations/schedule";
import {
  AUTOMATION_SCHEDULE_PRESETS,
  automationTimezoneOptions,
  defaultAutomationTimezone,
  formatAutomationTimestamp,
  rruleForPresetAtTime,
  schedulePresetAcceptsTime,
  validateAutomationRrule,
  validateAutomationTimezone,
} from "@proliferate/product-model/automations/schedule";
import type {
  CloudAgentRunConfig,
  CloudRepoConfigSummary,
  CreateAutomationRequest,
} from "@proliferate/cloud-sdk";
import {
  useAgentRunConfigs,
  useAutomationActions,
  useAutomations,
  useCloudRepoConfigs,
} from "@proliferate/cloud-sdk-react";

import {
  AutomationCreatePanel,
  type AutomationCreateFormValues,
  type AutomationCreateOption,
} from "@proliferate/product-ui/automations/AutomationCreatePanel";
import { AutomationsList } from "@proliferate/product-ui/automations/AutomationsList";
import { ProductNotice } from "@proliferate/product-ui/layout/ProductNotice";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";

const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];
const EMPTY_AGENT_CONFIGS: CloudAgentRunConfig[] = [];
const PERSONAL_OWNER_KEY = "personal";
const DEFAULT_SCHEDULE_PRESET: AutomationSchedulePreset = "daily";
const SCHEDULE_OPTIONS: AutomationCreateOption[] = AUTOMATION_SCHEDULE_PRESETS.map((option) => ({
  value: option.value,
  label: option.label,
}));

export function AutomationsScreen() {
  const automations = useAutomations();
  const repoConfigs = useCloudRepoConfigs();
  const agentRunConfigs = useAgentRunConfigs({
    ownerScope: "personal",
    usableIn: "personal_sandboxes",
    status: "active",
  });
  const actions = useAutomationActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [createValues, setCreateValues] = useState(createInitialFormValues);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<{
    automationId: string;
    action: "pause" | "resume" | "run";
  } | null>(null);

  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? EMPTY_REPO_CONFIGS),
    [repoConfigs.data?.configs],
  );
  const runConfigOptions = useMemo(
    () => buildRunConfigOptions(agentRunConfigs.data?.configs ?? EMPTY_AGENT_CONFIGS),
    [agentRunConfigs.data?.configs],
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
      const configStillAvailable = runConfigOptions.some((option) =>
        option.value === current.cloudAgentRunConfigId && !option.disabled
      );
      const nextRepoKey = repoStillAvailable
        ? current.repoKey
        : repoOptions.find((option) => !option.disabled)?.value ?? "";
      const nextConfigId = configStillAvailable
        ? current.cloudAgentRunConfigId
        : runConfigOptions.find((option) => !option.disabled)?.value ?? "";

      if (
        nextRepoKey === current.repoKey
        && nextConfigId === current.cloudAgentRunConfigId
      ) {
        return current;
      }
      return {
        ...current,
        repoKey: nextRepoKey,
        cloudAgentRunConfigId: nextConfigId,
      };
    });
  }, [createOpen, repoOptions, runConfigOptions]);

  async function submitCreate() {
    setCreateError(null);
    setActionError(null);
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

    const selectedRunConfig = agentRunConfigs.data?.configs.find((config) =>
      config.id === createValues.cloudAgentRunConfigId
    );
    if (!selectedRunConfig) {
      setCreateError("Choose an active agent run config before creating the automation.");
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

    const body: CreateAutomationRequest = {
      title,
      prompt,
      ownerScope: "personal",
      organizationId: null,
      gitOwner: repoIdentity.gitOwner,
      gitRepoName: repoIdentity.gitRepoName,
      schedule,
      targetMode: "personal_cloud",
      cloudAgentRunConfigId: selectedRunConfig.id,
    };

    try {
      await actions.createAutomation(body);
      setCreateValues(createInitialFormValues());
      setCreateOpen(false);
    } catch (error) {
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

  const optionLoadError = repoConfigs.error || agentRunConfigs.error
    ? "Could not load repo or agent config options. Retry from the page or refresh."
    : null;

  return (
    <ProductPageShell
      title="Automations"
      description="Scheduled personal cloud work for configured repos."
      telemetryBlocked
    >
      {createOpen ? (
        <div className="mb-4">
          <AutomationCreatePanel
            values={createValues}
            ownerOptions={[{ value: PERSONAL_OWNER_KEY, label: "Personal" }]}
            repoOptions={repoOptions}
            scheduleOptions={SCHEDULE_OPTIONS}
            timezoneOptions={timezoneOptions}
            runConfigOptions={runConfigOptions}
            loadingOptions={repoConfigs.isLoading || agentRunConfigs.isLoading}
            submitting={actions.creatingAutomation}
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
      {actionError ? (
        <ProductNotice
          tone="destructive"
          title="Automation action failed"
          description={actionError}
          className="mb-4"
        />
      ) : null}
      <AutomationsList
        loading={automations.isLoading}
        error={Boolean(automations.error)}
        onRetry={() => void automations.refetch()}
        onNew={() => {
          setCreateError(null);
          setCreateOpen(true);
        }}
        onPause={(automationId) => void runAutomationAction(automationId, "pause")}
        onResume={(automationId) => void runAutomationAction(automationId, "resume")}
        onRunNow={(automationId) => void runAutomationAction(automationId, "run")}
        busyAutomationId={busyAction?.automationId ?? null}
        busyAction={busyAction?.action ?? null}
        items={(automations.data?.automations ?? []).map((automation) => ({
          id: automation.id,
          title: automation.title,
          repo: `${automation.gitOwner}/${automation.gitRepoName}`,
          schedule: automation.schedule.summary,
          target: targetModeLabel(automation.targetMode),
          ownerLabel: "Personal",
          lastRun: automation.lastScheduledAt
            ? formatAutomationTimestamp(
              automation.lastScheduledAt,
              automation.schedule.timezone,
            )
            : null,
          nextRun: automation.schedule.nextRunAt
            ? formatAutomationTimestamp(
              automation.schedule.nextRunAt,
              automation.schedule.timezone,
            )
            : null,
          enabled: automation.enabled,
        }))}
      />
    </ProductPageShell>
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
    cloudAgentRunConfigId: "",
  };
}

function buildRepoOptions(configs: CloudRepoConfigSummary[]): AutomationCreateOption[] {
  return configs.map((config) => ({
    value: repoKey(config.gitOwner, config.gitRepoName),
    label: `${config.gitOwner}/${config.gitRepoName}${config.configured ? "" : " (not configured)"}`,
    disabled: !config.configured,
  }));
}

function buildRunConfigOptions(configs: CloudAgentRunConfig[]): AutomationCreateOption[] {
  return configs
    .filter((config) => config.status === "active")
    .map((config) => ({
      value: config.id,
      label: `${config.name} (${config.agentKind} - ${config.modelId})`,
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

function targetModeLabel(targetMode: string): string {
  switch (targetMode) {
    case "personal_cloud":
      return "Personal cloud";
    case "shared_cloud":
      return "Shared cloud";
    case "local":
      return "Desktop local";
    default:
      return targetMode;
  }
}
