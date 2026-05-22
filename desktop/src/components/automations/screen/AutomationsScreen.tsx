import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { PageContentFrame } from "@/components/ui/PageContentFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { ArrowLeft, Pause, Pencil, Play, Plus, Zap } from "@/components/ui/icons";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { AutomationDetailContent } from "@/components/automations/list/AutomationDetailContent";
import { AutomationEditorModal } from "@/components/automations/editor/AutomationEditorModal";
import { AutomationListContent } from "@/components/automations/list/AutomationListContent";
import { AUTOMATION_PREEXECUTOR_COPY } from "@/copy/automations/automation-copy";
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

const EMPTY_AUTOMATIONS: AutomationRecord[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunRecord[] = [];

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
  const { data: personalAutomationsData, isLoading: personalAutomationsLoading } =
    useAutomations(personalAutomationListOptions);
  const { data: teamAutomationsData, isLoading: teamAutomationsLoading } =
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

  const busy = actions.isCreatingAutomation
    || actions.isUpdatingAutomation
    || actions.isPausingAutomation
    || actions.isResumingAutomation
    || actions.isRunningAutomationNow;

  const renderCreateButton = () => (
    <Button onClick={openCreate}>
      <Plus className="size-4" />
      New automation
    </Button>
  );
  const renderDetailHeader = () => {
    if (!selectedAutomation) {
      return (
        <PageHeader
          title="Automation"
          description="Loading automation..."
        />
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-medium text-foreground">
              {view.title}
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">{view.repoLabel}</span>
              <span aria-hidden="true">-</span>
              <span>{view.executionLabel}</span>
              <span aria-hidden="true">-</span>
              <span>{view.statusLabel}</span>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{view.scheduleLabel}</span>
              <span aria-hidden="true">-</span>
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
  const pageHeader = isDetailView
    ? renderDetailHeader()
    : (
      <PageHeader
        title="Automations"
        description={AUTOMATION_PREEXECUTOR_COPY.pageDescription}
        action={renderCreateButton()}
      />
    );
  return (
    <>
      <MainSidebarPageShell>
        <PageContentFrame
          stickyTitle={isDetailView ? (selectedAutomation?.title ?? "Automation") : "Automations"}
          stickyAction={isDetailView ? undefined : renderCreateButton()}
          header={pageHeader}
        >
          {isDetailView ? (
            <AutomationDetailContent
              automation={selectedAutomation}
              loading={selectedDetailLoading}
              error={selectedDetailError}
              runs={runsData?.runs ?? EMPTY_AUTOMATION_RUNS}
              runsLoading={runsLoading}
              pendingCloudWorkspaceId={pendingCloudWorkspaceId}
              onBack={() => navigate("/automations")}
              onOpenCloudWorkspace={(cloudWorkspaceId) => {
                void handleOpenCloudWorkspace(cloudWorkspaceId);
              }}
              onOpenLocalWorkspace={(run) => {
                void handleOpenLocalWorkspace(run);
              }}
            />
          ) : (
            <div className="space-y-4">
              <AutomationListContent
                automations={automations}
                loading={isLoading}
                busy={busy}
                onSelect={(automationId) => navigate(`/automations/${automationId}`)}
                onEdit={openEdit}
                onPause={(automationId) => actions.pauseAutomation(automationId)}
                onResume={(automationId) => actions.resumeAutomation(automationId)}
                onRunNow={(automationId) => actions.runAutomationNow(automationId)}
              />
            </div>
          )}
        </PageContentFrame>
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
