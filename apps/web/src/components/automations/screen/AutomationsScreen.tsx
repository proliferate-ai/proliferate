import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@proliferate/cloud-sdk";
import {
  useAgentRunConfig,
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";
import {
  buildAutomationCalendarWeek,
  buildAutomationInventoryItems,
  buildAutomationRunInventoryItems,
  groupAutomationInventoryItems,
  type AutomationSurfaceViewMode,
} from "@proliferate/product-domain/automations/inventory";
import { AutomationDetailSurface } from "@proliferate/product-ui/automations/AutomationDetailSurface";
import { AutomationSurface } from "@proliferate/product-ui/automations/AutomationSurface";

import { routes } from "../../../config/routes";

const EMPTY_AUTOMATIONS: AutomationResponse[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunResponse[] = [];

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
  const [surfaceMode, setSurfaceMode] = useState<AutomationSurfaceViewMode>("list");
  const [includePausedCalendar, setIncludePausedCalendar] = useState(false);
  const [pendingCloudWorkspaceId, setPendingCloudWorkspaceId] = useState<string | null>(null);

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
    ? "Some workflows could not load. The list may be incomplete."
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
  const agentRunConfig = useAgentRunConfig(
    selectedAutomation?.cloudAgentRunConfigId ?? null,
    selectedAutomationId !== null && selectedAutomation !== null,
  );
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
  const selectedAutomationSummary = useMemo(() => {
    if (!selectedAutomation) {
      return null;
    }
    const resolvedRunConfig = agentRunConfig.data?.resolved;
    return {
      prompt: selectedAutomation.prompt,
      configName: resolvedRunConfig?.configName ?? agentRunConfig.data?.name ?? null,
      agentLabel: formatAgentKind(resolvedRunConfig?.agentKind ?? agentRunConfig.data?.agentKind),
      modelLabel: resolvedRunConfig?.modelId ?? agentRunConfig.data?.modelId ?? null,
    };
  }, [
    agentRunConfig.data?.agentKind,
    agentRunConfig.data?.modelId,
    agentRunConfig.data?.name,
    agentRunConfig.data?.resolved,
    selectedAutomation,
  ]);

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

  if (selectedAutomationId) {
    return (
      <AutomationDetailSurface
        automation={selectedAutomationItem}
        runs={runItems}
        summary={selectedAutomationSummary}
        loadingAutomation={selectedDetail.isLoading}
        loadingRuns={selectedDetail.isLoading || runs.isLoading}
        notFound={Boolean(selectedDetail.error)}
        onBack={() => navigate(routes.workflows)}
        onRunSelect={openRun}
      />
    );
  }

  return (
    <AutomationSurface
      mode={surfaceMode}
      groups={automationGroups}
      calendarDays={calendarDays}
      includePaused={includePausedCalendar}
      description="View scheduled work against configured cloud repositories."
      loading={automationsLoading}
      error={hasAutomationLoadError}
      actionError={partialAutomationLoadError}
      maxWidthClassName="max-w-none"
      onModeChange={setSurfaceMode}
      onIncludePausedChange={setIncludePausedCalendar}
      onRetry={() => {
        void personalAutomations.refetch();
        if (teamOrganizationId !== null) {
          void teamAutomations.refetch();
        }
      }}
      onAutomationSelect={(automationId) => navigate(routes.workflow(automationId))}
    />
  );
}

function formatAgentKind(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
