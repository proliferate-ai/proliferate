import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { PageContentFrame } from "@/components/ui/PageContentFrame";
import { ArrowLeft, Pause, Pencil, Play, Zap } from "@/components/ui/icons";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { AutomationEditorModal } from "@/components/automations/editor/AutomationEditorModal";
import { useAutomationActions } from "@/hooks/automations/workflows/use-automation-actions";
import {
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
} from "@/hooks/access/cloud/automations/use-automations";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { buildAutomationRowViewModel } from "@/lib/domain/automations/run/view-model";
import {
  buildCloudRepoSettingsHref,
  buildSharedCloudRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import { targetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type {
  AutomationRecord,
  AutomationRunRecord,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/domain/automations/run/ui-records";
import type { AutomationOwnerScope } from "@/lib/domain/automations/run/types";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  buildAutomationCalendarWeek,
  buildAutomationInventoryItems,
  buildAutomationRunInventoryItems,
  groupAutomationInventoryItems,
  type AutomationSurfaceViewMode,
} from "@proliferate/product-model/automations/inventory";
import { AutomationSurface } from "@proliferate/product-ui/automations/AutomationSurface";
import { AutomationRunsList } from "@proliferate/product-ui/automations/AutomationRunsList";

const EMPTY_AUTOMATIONS: AutomationRecord[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunRecord[] = [];
type AutomationListAction = "pause" | "resume" | "run";

interface AutomationsScreenProps {
  selectedAutomationId?: string | null;
}

export function AutomationsScreen({ selectedAutomationId = null }: AutomationsScreenProps) {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { refetch: refetchWorkspaces } = useWorkspaces();
  const [editingAutomation, setEditingAutomation] = useState<AutomationRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingCloudWorkspaceId, setPendingCloudWorkspaceId] = useState<string | null>(null);
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
  const { data: runsData, isLoading: runsLoading } = useAutomationRuns(
    selectedId,
    isDetailView,
  );
  const actions = useAutomationActions();
  const automationItems = useMemo(
    () => buildAutomationInventoryItems(automations),
    [automations],
  );
  const automationGroups = useMemo(
    () => groupAutomationInventoryItems(automationItems),
    [automationItems],
  );
  const calendarDays = useMemo(
    () => buildAutomationCalendarWeek(automations, {
      includePaused: includePausedCalendar,
    }),
    [automations, includePausedCalendar],
  );
  const runRecords: AutomationRunRecord[] = runsData?.runs ?? EMPTY_AUTOMATION_RUNS;
  const runItems = useMemo(
    () => buildAutomationRunInventoryItems(runRecords, { pendingCloudWorkspaceId }),
    [pendingCloudWorkspaceId, runRecords],
  );
  const runById = useMemo(
    () => new Map(runRecords.map((run) => [run.id, run])),
    [runRecords],
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

  const handleOpenCloudWorkspace = useCallback(async (cloudWorkspaceId: string) => {
    setPendingCloudWorkspaceId(cloudWorkspaceId);
    try {
      const workspace = await refreshCloudWorkspace(cloudWorkspaceId);
      navigate("/");
      await selectWorkspace(cloudWorkspaceSyntheticId(workspace.id), { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open workspace.";
      showToast(message);
    } finally {
      setPendingCloudWorkspaceId(null);
    }
  }, [navigate, refreshCloudWorkspace, selectWorkspace, showToast]);

  const handleOpenLocalWorkspace = async (run: AutomationRunRecord) => {
    if (!run.anyharnessWorkspaceId) {
      return;
    }
    const targetKind = run.targetKindSnapshot ?? run.cloudTargetKindSnapshot;
    const targetId = run.targetIdSnapshot ?? run.cloudTargetIdSnapshot;
    const workspaceId = targetKind === "ssh" && targetId
      ? targetWorkspaceSyntheticId(targetId, run.anyharnessWorkspaceId)
      : run.anyharnessWorkspaceId;
    try {
      await refetchWorkspaces();
      navigate("/");
      if (run.anyharnessSessionId) {
        const result = await openWorkspaceSession({
          workspaceId,
          sessionId: run.anyharnessSessionId,
        });
        if (result.result === "stale") {
          showToast("Workspace selection changed before the automation session opened.");
        }
        return;
      }
      await selectWorkspace(workspaceId, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open workspace.";
      showToast(message);
    }
  };

  const handleEditAutomation = (automationId: string) => {
    const automation = automations.find((item) => item.id === automationId);
    if (automation) {
      openEdit(automation);
    }
  };

  const handleOpenRun = (runId: string) => {
    const run = runById.get(runId);
    if (!run) {
      return;
    }
    const targetKind = run.targetKindSnapshot ?? run.cloudTargetKindSnapshot;
    const targetId = run.targetIdSnapshot ?? run.cloudTargetIdSnapshot;
    if (targetKind === "ssh" && targetId && run.anyharnessWorkspaceId) {
      void handleOpenLocalWorkspace(run);
      return;
    }
    if (run.cloudWorkspaceId) {
      void handleOpenCloudWorkspace(run.cloudWorkspaceId);
      return;
    }
    if (run.anyharnessWorkspaceId) {
      void handleOpenLocalWorkspace(run);
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

  const renderDetailHeader = () => {
    if (!selectedAutomation) {
      return (
        <div className="py-2">
          <h2 className="text-2xl font-medium text-foreground">Automation</h2>
          <p className="mt-1 text-sm text-muted-foreground">Loading automation...</p>
        </div>
      );
    }

    const view = buildAutomationRowViewModel(selectedAutomation);
    const enabled = selectedAutomation.enabled;
    return (
      <div className="relative flex min-w-0 flex-col">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/automations")}
          className="absolute -top-8 -ml-2 w-fit"
        >
          <ArrowLeft className="size-4" />
          Automations
        </Button>
        <div className="flex flex-col gap-4 border-b border-border/60 pb-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-medium text-foreground">
              {view.title}
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">{view.repoLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{view.executionLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{view.statusLabel}</span>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{view.scheduleLabel}</span>
              <span aria-hidden="true">·</span>
              <span>Next {view.nextRunPlainLabel}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => actions.runAutomationNow(selectedAutomation.id)}
              disabled={busy || !enabled}
              title={enabled ? "Queue a manual run" : "Resume before queueing a run"}
            >
              <Zap className="size-4" />
              Run now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(selectedAutomation)}
              disabled={busy}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
            {enabled ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.pauseAutomation(selectedAutomation.id)}
                disabled={busy}
              >
                <Pause className="size-4" />
                Pause
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.resumeAutomation(selectedAutomation.id)}
                disabled={busy}
              >
                <Play className="size-4" />
                Resume
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };
  return (
    <>
      <MainSidebarPageShell>
        {isDetailView ? (
          <PageContentFrame
            stickyTitle={selectedAutomation?.title ?? "Automation"}
            header={renderDetailHeader()}
            maxWidthClassName="max-w-none"
          >
            {selectedDetailError ? (
              <section className="py-3">
                <p className="text-sm font-medium text-foreground">Automation not found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  It may have been deleted or you may not have access to it.
                </p>
                <Button variant="ghost" size="sm" onClick={() => navigate("/automations")} className="mt-4 -ml-2">
                  <ArrowLeft className="size-4" />
                  Back to automations
                </Button>
              </section>
            ) : (
              <section className="min-w-0">
                <div className="mt-1 flex h-9 w-full items-center gap-2 rounded-[10px] bg-foreground/[0.042] px-3">
                  <span className="text-sm font-medium leading-5 text-foreground">Run history</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{runItems.length}</span>
                </div>
                <AutomationRunsList
                  runs={runItems}
                  loading={selectedDetailLoading || runsLoading}
                  onRunSelect={handleOpenRun}
                />
              </section>
            )}
          </PageContentFrame>
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
