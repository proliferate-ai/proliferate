import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { AutomationEditorModal } from "@/components/automations/editor/AutomationEditorModal";
import { useAutomationActions } from "@/hooks/automations/workflows/use-automation-actions";
import { useAutomationRunOpenActions } from "@/hooks/automations/workflows/use-automation-run-open-actions";
import {
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
} from "@/hooks/access/cloud/automations/use-automations";
import { useAgentRunConfig } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-configs";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import {
  buildCloudRepoSettingsHref,
  buildSharedCloudRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import type {
  AutomationRecord,
  AutomationRunRecord,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/domain/automations/run/ui-records";
import type { AutomationOwnerScope } from "@/lib/domain/automations/run/types";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  buildAutomationCalendarWeek,
  buildAutomationInventoryItems,
  buildAutomationRunInventoryItems,
  groupAutomationInventoryItems,
  type AutomationSurfaceViewMode,
} from "@proliferate/product-domain/automations/inventory";
import { AutomationDetailSurface } from "@proliferate/product-ui/automations/AutomationDetailSurface";
import { AutomationSurface } from "@proliferate/product-ui/automations/AutomationSurface";

const EMPTY_AUTOMATIONS: AutomationRecord[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunRecord[] = [];
type AutomationListAction = "pause" | "resume" | "run";

interface AutomationsScreenProps {
  selectedAutomationId?: string | null;
}

export function AutomationsScreen({ selectedAutomationId = null }: AutomationsScreenProps) {
  const navigate = useNavigate();
  const [editingAutomation, setEditingAutomation] = useState<AutomationRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingAutomationAction, setPendingAutomationAction] = useState<{
    automationId: string;
    action: AutomationListAction;
  } | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<AutomationSurfaceViewMode>("list");
  const [includePausedCalendar, setIncludePausedCalendar] = useState(false);
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canManageTeamAutomations = activeOrganizationId !== null && admin.isAdmin;
  const teamAutomationsEnabled = canManageTeamAutomations;
  const personalAutomationListOptions = useMemo(() => ({
    ownerScope: "personal" as AutomationOwnerScope,
    organizationId: null,
    enabled: true,
  }), []);
  const teamAutomationListOptions = useMemo(() => ({
    ownerScope: "organization" as AutomationOwnerScope,
    organizationId: activeOrganizationId,
    enabled: teamAutomationsEnabled,
  }), [activeOrganizationId, teamAutomationsEnabled]);
  const {
    data: personalAutomationsData,
    isLoading: personalAutomationsLoading,
    isError: personalAutomationsError,
    refetch: refetchPersonalAutomations,
  } =
    useAutomations(personalAutomationListOptions);
  const {
    data: teamAutomationsData,
    isLoading: teamAutomationsLoading,
    isError: teamAutomationsError,
    refetch: refetchTeamAutomations,
  } =
    useAutomations(teamAutomationListOptions);
  const automations = useMemo(() => {
    const combined = [
      ...(personalAutomationsData?.automations ?? EMPTY_AUTOMATIONS),
      ...(teamAutomationsData?.automations ?? EMPTY_AUTOMATIONS),
    ];
    return [...combined].sort((left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  }, [personalAutomationsData?.automations, teamAutomationsData?.automations]);
  const isLoading = personalAutomationsLoading || (teamAutomationsEnabled && teamAutomationsLoading);
  const automationLoadError = personalAutomationsError || (teamAutomationsEnabled && teamAutomationsError);
  const hasAutomationLoadError = automationLoadError && automations.length === 0;
  const partialAutomationLoadError = automationLoadError && automations.length > 0
    ? "Some automations could not load. The list may be incomplete."
    : null;
  const isDetailView = selectedAutomationId !== null;
  const selectedId = isDetailView ? selectedAutomationId : null;
  const selectedFromList = useMemo(
    () => automations.find((automation) => automation.id === selectedId) ?? null,
    [automations, selectedId],
  );
  const {
    data: selectedDetail,
    isLoading: selectedDetailLoading,
    isError: selectedDetailError,
  } = useAutomationDetail(
    selectedFromList ? null : selectedId,
    selectedId !== null && selectedFromList === null,
  );
  const selectedAutomation = selectedFromList ?? selectedDetail ?? null;
  const selectedAgentRunConfig = useAgentRunConfig(
    selectedAutomation?.cloudAgentRunConfigId ?? null,
    isDetailView && selectedAutomation !== null,
  );
  const { data: runsData, isLoading: runsLoading } = useAutomationRuns(
    selectedId,
    isDetailView,
  );
  const actions = useAutomationActions();
  const automationItems = useMemo(
    () => buildAutomationInventoryItems(automations, { clientSurface: "desktop" }),
    [automations],
  );
  const automationGroups = useMemo(
    () => groupAutomationInventoryItems(automationItems),
    [automationItems],
  );
  const calendarDays = useMemo(
    () => buildAutomationCalendarWeek(automations, {
      includePaused: includePausedCalendar,
      clientSurface: "desktop",
    }),
    [automations, includePausedCalendar],
  );
  const selectedAutomationItem = useMemo(
    () => selectedAutomation
      ? buildAutomationInventoryItems([selectedAutomation], { clientSurface: "desktop" })[0] ?? null
      : null,
    [selectedAutomation],
  );
  const runRecords: AutomationRunRecord[] = runsData?.runs ?? EMPTY_AUTOMATION_RUNS;
  const selectedAutomationSummary = useMemo(() => {
    if (!selectedAutomation) {
      return null;
    }
    const resolvedRunConfig = selectedAgentRunConfig.data?.resolved;
    return {
      prompt: selectedAutomation.prompt,
      configName: resolvedRunConfig?.configName ?? selectedAgentRunConfig.data?.name ?? null,
      agentLabel: formatAgentKind(resolvedRunConfig?.agentKind ?? selectedAgentRunConfig.data?.agentKind),
      modelLabel: resolvedRunConfig?.modelId ?? selectedAgentRunConfig.data?.modelId ?? null,
    };
  }, [
    selectedAgentRunConfig.data?.agentKind,
    selectedAgentRunConfig.data?.modelId,
    selectedAgentRunConfig.data?.name,
    selectedAgentRunConfig.data?.resolved,
    selectedAutomation,
  ]);
  const runById = useMemo(
    () => new Map(runRecords.map((run) => [run.id, run])),
    [runRecords],
  );
  const { openRun, pendingCloudWorkspaceId } = useAutomationRunOpenActions(runById);
  const runItems = useMemo(
    () => buildAutomationRunInventoryItems(runRecords, {
      clientSurface: "desktop",
      pendingCloudWorkspaceId,
    }),
    [pendingCloudWorkspaceId, runRecords],
  );

  const openCreate = () => {
    setEditingAutomation(null);
    setEditorOpen(true);
  };

  const openEdit = (automation: AutomationRecord) => {
    setEditingAutomation(automation);
    setEditorOpen(true);
  };

  const closeEditor = () => setEditorOpen(false);

  const handleConfigureCloudTarget = (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => {
    setEditorOpen(false);
    navigate(target.ownerScope === "organization"
      ? buildSharedCloudRepoSettingsHref(target.gitOwner, target.gitRepoName)
      : buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
  };

  const handleCreate = async (body: CreateAutomationInput) => {
    const created = await actions.createAutomation(body);
    navigate(`/automations/${created.id}`);
  };

  const handleUpdate = async (automationId: string, body: UpdateAutomationInput) => {
    await actions.updateAutomation({ automationId, body });
  };

  const handleEditAutomation = (automationId: string) => {
    const automation = automations.find((item) => item.id === automationId);
    if (automation) {
      openEdit(automation);
    }
  };

  const performAutomationListAction = async (
    automationId: string,
    action: AutomationListAction,
    run: () => Promise<void>,
  ) => {
    if (busy || pendingAutomationAction) {
      return;
    }
    setPendingAutomationAction({ automationId, action });
    try {
      await run();
    } finally {
      setPendingAutomationAction(null);
    }
  };

  const busy = actions.isCreatingAutomation
    || actions.isUpdatingAutomation
    || actions.isPausingAutomation
    || actions.isResumingAutomation
    || actions.isRunningAutomationNow;

  return (
    <>
      <MainSidebarPageShell>
        {isDetailView ? (
          <AutomationDetailSurface
            automation={selectedAutomationItem}
            runs={runItems}
            summary={selectedAutomationSummary}
            loadingAutomation={selectedDetailLoading}
            loadingRuns={selectedDetailLoading || runsLoading}
            notFound={selectedDetailError}
            busy={busy}
            onBack={() => navigate("/automations")}
            onRunNow={(automationId) => {
              void actions.runAutomationNow(automationId);
            }}
            onEdit={(automationId) => {
              const automation = automations.find((item) => item.id === automationId) ?? selectedAutomation;
              if (automation) {
                openEdit(automation);
              }
            }}
            onPause={(automationId) => {
              void actions.pauseAutomation(automationId);
            }}
            onResume={(automationId) => {
              void actions.resumeAutomation(automationId);
            }}
            onRunSelect={openRun}
          />
        ) : (
          <AutomationSurface
            mode={surfaceMode}
            groups={automationGroups}
            calendarDays={calendarDays}
            includePaused={includePausedCalendar}
            loading={isLoading}
            error={hasAutomationLoadError}
            actionError={partialAutomationLoadError}
            busyAutomationId={pendingAutomationAction?.automationId ?? null}
            busyAction={pendingAutomationAction?.action ?? null}
            actionsDisabled={busy || pendingAutomationAction !== null}
            onModeChange={setSurfaceMode}
            onIncludePausedChange={setIncludePausedCalendar}
            onNew={openCreate}
            onRetry={() => {
              void refetchPersonalAutomations();
              if (teamAutomationsEnabled) {
                void refetchTeamAutomations();
              }
            }}
            onAutomationSelect={(automationId) => navigate(`/automations/${automationId}`)}
            onEdit={handleEditAutomation}
            onPause={(automationId) => {
              void performAutomationListAction(
                automationId,
                "pause",
                () => actions.pauseAutomation(automationId),
              );
            }}
            onResume={(automationId) => {
              void performAutomationListAction(
                automationId,
                "resume",
                () => actions.resumeAutomation(automationId),
              );
            }}
            onRunNow={(automationId) => {
              void performAutomationListAction(
                automationId,
                "run",
                () => actions.runAutomationNow(automationId),
              );
            }}
          />
        )}
      </MainSidebarPageShell>

      {editorOpen && (
        <AutomationEditorModal
          key={editingAutomation?.id ?? "new"}
          open={editorOpen}
          automation={editingAutomation}
          busy={busy}
          initialOwnerScope="personal"
          organizationId={activeOrganizationId}
          organizationName={activeOrganization?.name ?? null}
          canManageTeamAutomations={canManageTeamAutomations}
          onClose={closeEditor}
          onConfigureCloudTarget={handleConfigureCloudTarget}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </>
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
