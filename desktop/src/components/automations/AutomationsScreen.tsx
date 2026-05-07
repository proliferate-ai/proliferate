import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { PageContentFrame } from "@/components/ui/PageContentFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { ArrowLeft, Pause, Pencil, Play, Plus, Zap } from "@/components/ui/icons";
import { MainSidebarPageShell } from "@/components/workspace/shell/MainSidebarPageShell";
import { AutomationDetailContent } from "./AutomationDetailContent";
import { AutomationEditorModal } from "./AutomationEditorModal";
import { AutomationListContent } from "./AutomationListContent";
import { AUTOMATION_PREEXECUTOR_COPY } from "@/copy/automations/automation-copy";
import { useAutomationActions } from "@/hooks/automations/use-automation-actions";
import {
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
} from "@/hooks/automations/use-automations";
import { useCloudWorkspaceActions } from "@/hooks/cloud/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { buildAutomationRowViewModel } from "@/lib/domain/automations/view-model";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import type {
  AutomationResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/access/cloud/client";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/use-workspace-activation-workflow";

const EMPTY_AUTOMATIONS: AutomationResponse[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunResponse[] = [];

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
  const [editingAutomation, setEditingAutomation] = useState<AutomationResponse | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingCloudWorkspaceId, setPendingCloudWorkspaceId] = useState<string | null>(null);

  const { data: automationsData, isLoading } = useAutomations(true);
  const automations = automationsData?.automations ?? EMPTY_AUTOMATIONS;
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

  const openEdit = (automation: AutomationResponse) => {
    setEditingAutomation(automation);
    setEditorOpen(true);
  };

  const closeEditor = () => setEditorOpen(false);

  const handleConfigureCloudTarget = (target: { gitOwner: string; gitRepoName: string }) => {
    setEditorOpen(false);
    navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
  };

  const handleCreate = async (body: CreateAutomationRequest) => {
    const created = await actions.createAutomation(body);
    navigate(`/automations/${created.id}`);
  };

  const handleUpdate = async (automationId: string, body: UpdateAutomationRequest) => {
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

  const handleOpenLocalWorkspace = async (run: AutomationRunResponse) => {
    if (!run.anyharnessWorkspaceId) {
      return;
    }
    try {
      await refetchWorkspaces();
      navigate("/");
      if (run.anyharnessSessionId) {
        const result = await openWorkspaceSession({
          workspaceId: run.anyharnessWorkspaceId,
          sessionId: run.anyharnessSessionId,
        });
        if (result.result === "stale") {
          showToast("Workspace selection changed before the automation session opened.");
        }
        return;
      }
      await selectWorkspace(run.anyharnessWorkspaceId, { force: true });
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
          )}
        </PageContentFrame>
      </MainSidebarPageShell>

      {editorOpen && (
        <AutomationEditorModal
          key={editingAutomation?.id ?? "new"}
          open={editorOpen}
          automation={editingAutomation}
          busy={busy}
          onClose={closeEditor}
          onConfigureCloudTarget={handleConfigureCloudTarget}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </>
  );
}
