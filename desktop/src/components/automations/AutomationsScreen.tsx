import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Calendar, Plus, SplitPanel } from "@/components/ui/icons";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { AutomationDetailContent } from "./AutomationDetailContent";
import { AutomationEditorModal } from "./AutomationEditorModal";
import { AutomationListContent } from "./AutomationListContent";
import { AUTOMATION_PREEXECUTOR_COPY, automationsUiEnabled } from "@/config/automations";
import { useAutomationActions } from "@/hooks/automations/use-automation-actions";
import {
  useAutomationDetail,
  useAutomationRuns,
  useAutomations,
} from "@/hooks/automations/use-automations";
import { useCloudRepoConfigs } from "@/hooks/cloud/use-cloud-repo-configs";
import { useResize } from "@/hooks/layout/use-resize";
import { useSettingsRepositories } from "@/hooks/settings/use-settings-repositories";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";
import { useUpdater } from "@/hooks/updater/use-updater";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { buildAutomationRepositoryOptions } from "@/lib/domain/automations/repositories";
import type {
  AutomationResponse,
  AutomationRunResponse,
  CloudRepoConfigSummary,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/integrations/cloud/client";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";

const EMPTY_AUTOMATIONS: AutomationResponse[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRunResponse[] = [];
const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];

const GLASS_HEADER_CLASS =
  "flex h-10 shrink-0 items-center border-b border-foreground/10 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20";
const SOLID_HEADER_CLASS = "flex h-10 shrink-0 items-center";

interface AutomationsScreenProps {
  selectedAutomationId?: string | null;
}

export function AutomationsScreen({ selectedAutomationId = null }: AutomationsScreenProps) {
  const navigate = useNavigate();
  const sidebarOpen = useWorkspaceUiStore((s) => s.sidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((s) => s.sidebarWidth);
  const setSidebarOpen = useWorkspaceUiStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useWorkspaceUiStore((s) => s.setSidebarWidth);
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const { phase: updaterPhase, downloadUpdate, openRestartPrompt } = useUpdater();
  const [editingAutomation, setEditingAutomation] = useState<AutomationResponse | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const enabled = automationsUiEnabled();
  const { data: automationsData, isLoading } = useAutomations(enabled);
  const { data: repoConfigsData } = useCloudRepoConfigs(enabled);
  const { repositories } = useSettingsRepositories();
  const { cloudWorkspaces } = useStandardRepoProjection();
  const automations = automationsData?.automations ?? EMPTY_AUTOMATIONS;
  const repositoryOptions = useMemo(
    () => buildAutomationRepositoryOptions({
      repoConfigs: repoConfigsData?.configs ?? EMPTY_REPO_CONFIGS,
      cloudWorkspaces,
      repositories,
    }),
    [cloudWorkspaces, repoConfigsData?.configs, repositories],
  );
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
    enabled && selectedId !== null && selectedFromList === null,
  );
  const selectedAutomation = selectedFromList ?? selectedDetail ?? null;
  const { data: runsData, isLoading: runsLoading } = useAutomationRuns(
    selectedId,
    enabled && isDetailView,
  );
  const actions = useAutomationActions();

  const onLeftSeparatorDown = useResize({
    direction: "horizontal",
    size: sidebarWidth,
    onResize: setSidebarWidth,
    min: WORKSPACE_SIDEBAR_MIN_WIDTH,
    max: WORKSPACE_SIDEBAR_MAX_WIDTH,
  });

  const openCreate = () => {
    setEditingAutomation(null);
    setEditorOpen(true);
  };

  const openEdit = (automation: AutomationResponse) => {
    setEditingAutomation(automation);
    setEditorOpen(true);
  };

  const closeEditor = () => setEditorOpen(false);

  const handleCreate = async (body: CreateAutomationRequest) => {
    const created = await actions.createAutomation(body);
    navigate(`/automations/${created.id}`);
  };

  const handleUpdate = async (automationId: string, body: UpdateAutomationRequest) => {
    await actions.updateAutomation({ automationId, body });
  };

  const busy = actions.isCreatingAutomation
    || actions.isUpdatingAutomation
    || actions.isPausingAutomation
    || actions.isResumingAutomation
    || actions.isRunningAutomationNow;

  return (
    <div
      className={`flex h-screen overflow-hidden ${
        transparentChromeEnabled ? "bg-transparent" : "bg-sidebar"
      }`}
      data-telemetry-block
    >
      <div
        id="main-sidebar"
        className="flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-150 ease-in-out"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          <div className="flex h-full items-center gap-2 pl-[82px]">
            <IconButton
              tone="sidebar"
              size="sm"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="rounded-md"
            >
              <SplitPanel className="size-4" />
            </IconButton>
            <SidebarUpdatePill
              phase={updaterPhase}
              onDownloadUpdate={downloadUpdate}
              onOpenRestartPrompt={openRestartPrompt}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MainSidebar />
        </div>
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="main-sidebar"
          onMouseDown={onLeftSeparatorDown}
          className="relative z-10 -ml-1 flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/30 active:bg-primary/50"
        />
      )}

      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden ${
          transparentChromeEnabled ? "bg-transparent" : "bg-background"
        } ${sidebarOpen && !transparentChromeEnabled ? "rounded-tl-[22px] border-l border-t border-sidebar-border" : ""}`}
      >
        <div
          className={transparentChromeEnabled ? GLASS_HEADER_CLASS : SOLID_HEADER_CLASS}
          data-tauri-drag-region="true"
        >
          {!sidebarOpen && (
            <div className="flex items-center gap-2 pl-[82px] pr-2">
              <IconButton
                size="sm"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                className="rounded-md"
              >
                <SplitPanel className="size-4" />
              </IconButton>
              <SidebarUpdatePill
                phase={updaterPhase}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="size-4" />
                  <span className="text-xs uppercase tracking-wide">Automations</span>
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-foreground">
                  Scheduled agent runs
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {AUTOMATION_PREEXECUTOR_COPY.pageDescription}
                </p>
              </div>
              <Button onClick={openCreate} disabled={!enabled}>
                <Plus className="size-4" />
                New automation
              </Button>
            </div>

            {!enabled ? (
              <div className="rounded-lg border border-border bg-foreground/5 p-5 text-sm text-muted-foreground">
                Automations are disabled in this build.
              </div>
            ) : isDetailView ? (
              <AutomationDetailContent
                automation={selectedAutomation}
                loading={selectedDetailLoading}
                error={selectedDetailError}
                runs={runsData?.runs ?? EMPTY_AUTOMATION_RUNS}
                runsLoading={runsLoading}
                busy={busy}
                onBack={() => navigate("/automations")}
                onEdit={() => {
                  if (selectedAutomation) openEdit(selectedAutomation);
                }}
                onPause={() => {
                  if (selectedAutomation) actions.pauseAutomation(selectedAutomation.id);
                }}
                onResume={() => {
                  if (selectedAutomation) actions.resumeAutomation(selectedAutomation.id);
                }}
                onRunNow={() => {
                  if (selectedAutomation) actions.runAutomationNow(selectedAutomation.id);
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
          </div>
        </div>
      </div>

      <AutomationEditorModal
        open={editorOpen}
        automation={editingAutomation}
        repositoryOptions={repositoryOptions}
        busy={busy}
        onClose={closeEditor}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
