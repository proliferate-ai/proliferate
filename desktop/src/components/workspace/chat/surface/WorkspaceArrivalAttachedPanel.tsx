import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { SupportDialog } from "@/components/support/SupportDialog";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { useWorkspaceArrivalActions } from "@/hooks/workspaces/use-workspace-arrival-actions";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";
import { usePendingWorkspaceEntryActions } from "@/hooks/workspaces/use-pending-workspace-entry-actions";
import { useCloudWorkspaceStatusScreenActions } from "@/hooks/cloud/use-cloud-workspace-status-screen-actions";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { ArrowUpRight, LoaderCircle, X } from "@/components/ui/icons";

function SectionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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

function PendingCloudStatusHeader({
  title,
  description,
  repoLabel,
  branchLabel,
  steps,
}: {
  title: string;
  description: string;
  repoLabel: string;
  branchLabel: string;
  steps: Array<{
    status: string;
    state: "complete" | "active" | "idle";
  }>;
}) {
  return (
    <>
      <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
        <span className="inline-flex items-center gap-1">
          <LoaderCircle className="size-3 animate-spin" />
          <span>Cloud workspace</span>
        </span>
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="min-w-0 truncate text-sm font-medium text-foreground">
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {repoLabel} · {branchLabel} · {description}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {steps.map((step) => (
            <span
              key={step.status}
              className={
                step.state === "complete"
                  ? "h-1 flex-1 rounded-full bg-foreground/75"
                  : step.state === "active"
                    ? "h-1 flex-1 rounded-full bg-warning"
                    : "h-1 flex-1 rounded-full bg-foreground/12"
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function WorkspaceArrivalAttachedPanel() {
  const panelState = useWorkspaceStatusPanelState();
  const [expanded, setExpanded] = useState(true);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const { handleRetry, handleBack } = usePendingWorkspaceEntryActions();

  const arrivalActions = useWorkspaceArrivalActions({
    workspacePath: panelState?.kind === "arrival" ? panelState.workspacePath : null,
    sourceRepoRootPath: panelState?.kind === "arrival" ? panelState.sourceRepoRootPath : null,
  });
  const cloudActions = useCloudWorkspaceStatusScreenActions({
    workspaceId: panelState?.kind === "cloud-status" ? panelState.workspaceId : "",
    mode: panelState?.kind === "cloud-status" ? panelState.model.mode : "pending",
  });

  if (!panelState) {
    return null;
  }

  const rerunSetup = useRerunSetupMutation();

  if (panelState.kind === "arrival") {
    const { viewModel } = panelState;
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
              <IconButton title="Dismiss" size="sm" onClick={arrivalActions.handleDismiss}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          </>
        )}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
      >
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
            {viewModel.setupTone === "destructive" ? (
              <button
                type="button"
                onClick={() => {
                  void rerunSetup.mutateAsync(viewModel.workspaceId);
                }}
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {viewModel.setupActionLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={arrivalActions.handleOpenRepositorySettings}
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {viewModel.setupActionLabel}
                <ArrowUpRight className="size-3" />
              </button>
            )}
          </div>
        </SectionRow>


      </ComposerAttachedPanel>
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
              <button
                type="button"
                onClick={() => {
                  clearSetupFailureDismissal(panelState.workspaceId);
                  void rerunSetup.mutateAsync(panelState.workspaceId);
                }}
                className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Rerun
              </button>
              <IconButton
                title="Dismiss"
                size="sm"
                onClick={() => dismissSetupFailure(panelState.workspaceId)}
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
        {panelState.detail && (
          <SectionRow label="Details">
            <span className="truncate text-base text-muted-foreground">
              {panelState.detail}
            </span>
          </SectionRow>
        )}

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
      </ComposerAttachedPanel>
    );
  }

  const { model } = panelState;
  if (model.mode === "pending") {
    return (
      <ComposerAttachedPanel
        header={(
          <PendingCloudStatusHeader
            title={model.title}
            description={model.description}
            repoLabel={model.repoLabel}
            branchLabel={model.branchLabel}
            steps={model.steps}
          />
        )}
      />
    );
  }

  return (
    <ComposerAttachedPanel
      header={(
        <>
          <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
            <span>Cloud workspace</span>
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {model.title}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {model.description}
          </span>
        </>
      )}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
    >
      <SectionRow label="Repository">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
          <span className="text-foreground">{model.repoLabel}</span>
          <span>{model.branchLabel}</span>
          {model.stepCounter && (
            <span>
              Step {model.stepCounter.current} of {model.stepCounter.total}
            </span>
          )}
        </div>
      </SectionRow>

      <div className="border-t border-border/40">
        {model.steps.map((step) => (
          <div key={step.status} className="flex items-start gap-3 px-4 py-2.5">
            <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {step.state === "active" ? (
                <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
              ) : step.state === "complete" ? (
                <span className="size-2 rounded-full bg-foreground/70" />
              ) : (
                <span className="size-2 rounded-full bg-muted-foreground/30" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={step.state === "idle" ? "text-muted-foreground" : "text-foreground"}>
                  {step.label}
                </span>
                {step.statusBadge === "in-progress" && (
                  <span className="text-xs text-muted-foreground">In progress</span>
                )}
              </div>
              {step.showDescription && (
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                  {step.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {model.footer.kind === "action" ? (
        <SectionRow label="Actions">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              loading={cloudActions.isPrimaryActionPending}
              onClick={cloudActions.handlePrimaryAction ?? undefined}
            >
              {model.footer.label}
            </Button>
            <span className="text-sm text-muted-foreground">{model.footer.helperText}</span>
          </div>
        </SectionRow>
      ) : model.footer.kind === "support" ? (
        <SectionRow label="Actions">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => setSupportDialogOpen(true)}
            >
              {model.footer.label}
            </Button>
            <span className="text-sm text-muted-foreground">{model.footer.helperText}</span>
          </div>
        </SectionRow>
      ) : (
        <SectionRow label="Status">
          <span className="text-sm text-muted-foreground">{model.footer.message}</span>
        </SectionRow>
      )}
      {model.footer.kind === "support" && (
        <SupportDialog
          open={supportDialogOpen}
          onClose={() => setSupportDialogOpen(false)}
          title="Unlimited Cloud"
          description="Hosted cloud is free by default. If you want unlimited usage, reach out directly here."
          defaultMessage={`I want unlimited cloud usage for ${model.repoLabel} (${model.branchLabel}).`}
          context={{
            source: "cloud_gated",
            intent: "unlimited_cloud",
            workspaceId: panelState.workspaceId,
            workspaceName: model.repoLabel,
            workspaceLocation: "cloud",
          }}
        />
      )}
    </ComposerAttachedPanel>
  );
}
