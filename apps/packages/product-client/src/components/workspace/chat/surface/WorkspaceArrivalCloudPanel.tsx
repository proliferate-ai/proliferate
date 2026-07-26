import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { ComposerAttachedPanel } from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import { CloudStatusCompactHeader } from "#product/components/workspace/chat/surface/CloudStatusCompactHeader";
import {
  buildCloudWorkspaceCompactStatusView,
  type CloudWorkspaceStatusScreenMode,
  type CloudWorkspaceStatusScreenModel,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { CircleAlert, Spinner } from "@proliferate/ui/icons";

function SectionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border/40 px-4 py-2">
      <span className="w-20 shrink-0 text-chat font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function shouldExpandByDefault(mode: CloudWorkspaceStatusScreenMode): boolean {
  return mode === "blocked"
    || mode === "error"
    || mode === "lost"
    || mode === "archived";
}

function cloudStatusIcon(model: CloudWorkspaceStatusScreenModel) {
  if (model.mode === "pending") {
    return <Spinner className="icon-compact" />;
  }
  return <CircleAlert className="icon-compact" />;
}

interface WorkspaceArrivalCloudPanelProps {
  model: CloudWorkspaceStatusScreenModel;
  isPrimaryActionPending: boolean;
  onPrimaryAction: (() => void) | null;
  pendingPromptCount?: number;
}

export function WorkspaceArrivalCloudPanel({
  model,
  isPrimaryActionPending,
  onPrimaryAction,
  pendingPromptCount = 0,
}: WorkspaceArrivalCloudPanelProps) {
  const compactView = buildCloudWorkspaceCompactStatusView(model);
  const [expanded, setExpanded] = useState(() => shouldExpandByDefault(model.mode));
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const previousModeRef = useRef(model.mode);

  useEffect(() => {
    if (shouldExpandByDefault(model.mode) && previousModeRef.current !== model.mode) {
      setExpanded(true);
    }
    previousModeRef.current = model.mode;
  }, [model.mode]);

  const primaryActionHandler = (
    model.footer.kind === "action"
    && model.footer.action === "delete"
  )
    ? () => setDeleteConfirmationOpen(true)
    : onPrimaryAction;
  const primaryAction = compactView.primaryAction && primaryActionHandler
    ? {
      label: compactView.primaryAction.label,
      loading: isPrimaryActionPending,
      onClick: primaryActionHandler,
    }
    : null;

  return (
    <ComposerAttachedPanel
      header={(
        <CloudStatusCompactHeader
          title={compactView.title}
          phaseLabel={compactView.phaseLabel}
          tone={compactView.tone}
          statusIcon={cloudStatusIcon(model)}
          primaryAction={primaryAction}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((value) => !value)}
        />
      )}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
    >
      <div className="max-h-[min(32vh,280px)] overflow-y-auto">
        <SectionRow label="Repository">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-chat text-muted-foreground">
            <span className="text-foreground">{model.repoLabel}</span>
            <span>{model.branchLabel}</span>
          </div>
        </SectionRow>

        {model.footer.kind === "action" ? (
          <SectionRow label="Actions">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                loading={isPrimaryActionPending}
                onClick={primaryActionHandler ?? undefined}
              >
                {model.footer.label}
              </Button>
              <span className="text-chat text-muted-foreground">{model.footer.helperText}</span>
            </div>
          </SectionRow>
        ) : (
          <SectionRow label="Status">
            <span className="text-chat text-muted-foreground">{model.footer.message}</span>
          </SectionRow>
        )}

        {pendingPromptCount > 0 ? (
          <SectionRow label="Prompt">
            <span className="text-chat text-muted-foreground">
              Queued prompt will send when this cloud workspace is ready.
            </span>
          </SectionRow>
        ) : null}
      </div>
      <ConfirmationDialog
        open={deleteConfirmationOpen}
        title="Delete lost workspace?"
        description="Remove this workspace record. Anything pushed to GitHub, including commits, branches, and pull requests, remains available."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={isPrimaryActionPending}
        disableClose={isPrimaryActionPending}
        onClose={() => setDeleteConfirmationOpen(false)}
        onConfirm={() => {
          setDeleteConfirmationOpen(false);
          onPrimaryAction?.();
        }}
      />
    </ComposerAttachedPanel>
  );
}
