import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { WorkspaceArrivalCloudPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalCloudPanel";
import { useWorkspaceArrivalActions } from "@/hooks/workspaces/use-workspace-arrival-actions";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";
import { usePendingWorkspaceEntryActions } from "@/hooks/workspaces/use-pending-workspace-entry-actions";
import { useCloudWorkspaceStatusScreenActions } from "@/hooks/cloud/use-cloud-workspace-status-screen-actions";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import { ArrowUpRight, LoaderCircle, X } from "@/components/ui/icons";
import type { WorkspaceArrivalViewModel } from "@/lib/domain/workspaces/arrival";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";

function SectionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border/40 px-4 py-2">
      <span className="w-20 shrink-0 text-base font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface WorkspaceArrivalAttachedPanelViewProps {
  viewModel: WorkspaceArrivalViewModel;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDismiss: () => void;
  onSetupAction: () => void;
}

export function WorkspaceArrivalAttachedPanelView({
  viewModel,
  expanded,
  onToggleExpanded,
  onDismiss,
  onSetupAction,
}: WorkspaceArrivalAttachedPanelViewProps) {
  const setupToneColor =
    viewModel.setupTone === "destructive"
      ? "text-destructive"
      : "text-foreground";
  const isSetupRunning = viewModel.setupStatusLabel === "Running"
    || viewModel.setupStatusLabel === "Queued";

  return (
    <ComposerAttachedPanel
      header={(
        <>
          <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
            {viewModel.badgeLabel}
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {viewModel.title}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {viewModel.subtitle}
          </span>
          <div className="ml-auto shrink-0">
            <IconButton title="Dismiss" size="sm" onClick={onDismiss}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        </>
      )}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
    >
      <div className="max-h-[min(32vh,280px)] overflow-y-auto">
        <SectionRow label="Setup">
          <div className="flex items-center gap-2 text-base">
            {isSetupRunning && (
              <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
            )}
            <span className={`shrink-0 whitespace-nowrap ${setupToneColor}`}>{viewModel.setupStatusLabel}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="group/setup-error relative min-w-0 truncate text-muted-foreground">
              {viewModel.setupSummary}
              {viewModel.setupDetail && (
                <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden max-w-md whitespace-pre-wrap rounded-lg border border-border/60 bg-popover px-3 py-2 font-mono text-xs text-popover-foreground shadow-floating group-hover/setup-error:block">
                  {viewModel.setupDetail}
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSetupAction}
              className="ml-auto h-6 shrink-0 px-1.5"
            >
              {viewModel.setupActionLabel}
              {viewModel.setupTone !== "destructive" && <ArrowUpRight className="size-3" />}
            </Button>
          </div>
        </SectionRow>
      </div>
    </ComposerAttachedPanel>
  );
}

export function WorkspaceArrivalAttachedPanel() {
  const panelState = useWorkspaceStatusPanelState();
  const [expanded, setExpanded] = useState(true);
  const { handleRetry, handleBack } = usePendingWorkspaceEntryActions();
  const deferredLaunchesById = useDeferredHomeLaunchStore((state) => state.launches);
  const deferredWorkspaceId = panelState?.kind === "pending"
    ? panelState.entry.workspaceId
    : panelState?.kind === "cloud-status"
      ? panelState.workspaceId
      : null;
  const deferredPromptCount = useMemo(() => {
    if (!deferredWorkspaceId) {
      return 0;
    }
    return Object.values(deferredLaunchesById).filter(
      (launch) => launch.workspaceId === deferredWorkspaceId,
    ).length;
  }, [deferredLaunchesById, deferredWorkspaceId]);

  const arrivalActions = useWorkspaceArrivalActions({
    workspacePath: panelState?.kind === "arrival" ? panelState.workspacePath : null,
    sourceRepoRootPath: panelState?.kind === "arrival" ? panelState.sourceRepoRootPath : null,
  });
  const cloudActions = useCloudWorkspaceStatusScreenActions({
    workspaceId: panelState?.kind === "cloud-status" ? panelState.workspaceId : "",
    mode: panelState?.kind === "cloud-status" ? panelState.model.mode : "pending",
  });
  const rerunSetup = useRerunSetupMutation();
  const shellActions = useWorkspaceShellActions();

  if (!panelState) {
    return null;
  }

  if (panelState.kind === "arrival") {
    const { viewModel } = panelState;
    return (
      <WorkspaceArrivalAttachedPanelView
        viewModel={viewModel}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        onDismiss={arrivalActions.handleDismiss}
        onSetupAction={
          viewModel.setupTerminalId
            ? () => {
                shellActions?.openTerminalPanel(viewModel.setupTerminalId ?? undefined);
              }
            : arrivalActions.handleOpenRepositorySettings
        }
      />
    );
  }

  if (panelState.kind === "setup-failure") {
    const dismissSetupFailure = useWorkspaceUiStore.getState().dismissSetupFailure;
    const clearSetupFailureDismissal = useWorkspaceUiStore.getState().clearSetupFailureDismissal;

    return (
      <ComposerAttachedPanel
        header={(
          <>
            <Badge className="shrink-0 rounded-full bg-destructive/10 text-destructive border-destructive/20 px-2 py-0.5 text-base">
              Setup failed
            </Badge>
            <span className="group/setup-error relative min-w-0 truncate text-sm text-muted-foreground">
              {panelState.summary}
              {panelState.detail && (
                <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden max-w-md whitespace-pre-wrap rounded-lg border border-border/60 bg-popover px-3 py-2 font-mono text-xs text-popover-foreground shadow-floating group-hover/setup-error:block">
                  {panelState.detail}
                </span>
              )}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {panelState.terminalId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => {
                    shellActions?.openTerminalPanel(panelState.terminalId ?? undefined);
                  }}
                >
                  Open terminal
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearSetupFailureDismissal(panelState.workspaceUiKey);
                  void rerunSetup.mutateAsync(panelState.materializedWorkspaceId);
                }}
                className="h-6 px-2"
              >
                Rerun
              </Button>
              <IconButton
                title="Dismiss"
                size="sm"
                onClick={() => dismissSetupFailure(panelState.workspaceUiKey)}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          </>
        )}
        expanded={false}
        onToggleExpanded={() => {}}
      />
    );
  }

  if (panelState.kind === "pending") {
    const isBusy = !panelState.isFailed;

    return (
      <ComposerAttachedPanel
        header={(
          <>
            <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
              <span className="inline-flex items-center gap-1">
                {isBusy && <LoaderCircle className="size-3 animate-spin" />}
                <span>{panelState.badgeLabel}</span>
              </span>
            </Badge>
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {panelState.title}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {panelState.subtitle}
            </span>
          </>
        )}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
      >
        <div className="max-h-[min(32vh,280px)] overflow-y-auto">
          {panelState.detail && (
            <SectionRow label="Details">
              <span className="truncate text-base text-muted-foreground">
                {panelState.detail}
              </span>
            </SectionRow>
          )}

          {deferredPromptCount > 0 ? (
            <SectionRow label="Prompt">
              <span className="truncate text-base text-muted-foreground">
                Queued prompt will send when this cloud workspace is ready.
              </span>
            </SectionRow>
          ) : null}

          {panelState.isFailed && (
            <SectionRow label="Actions">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleBack(panelState.entry);
                  }}
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void handleRetry(panelState.entry);
                  }}
                >
                  Retry
                </Button>
              </div>
            </SectionRow>
          )}
        </div>
      </ComposerAttachedPanel>
    );
  }

  const { model } = panelState;
  return (
    <WorkspaceArrivalCloudPanel
      model={model}
      isPrimaryActionPending={cloudActions.isPrimaryActionPending}
      onPrimaryAction={cloudActions.handlePrimaryAction}
      pendingPromptCount={deferredPromptCount}
    />
  );
}
