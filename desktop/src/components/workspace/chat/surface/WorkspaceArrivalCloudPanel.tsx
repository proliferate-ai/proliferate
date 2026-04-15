import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { CloudStatusCompactHeader } from "@/components/workspace/chat/surface/CloudStatusCompactHeader";
import {
  buildCloudWorkspaceCompactStatusView,
  type CloudWorkspaceStatusScreenMode,
  type CloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import { CircleAlert, LoaderCircle } from "@/components/ui/icons";

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

function shouldExpandByDefault(mode: CloudWorkspaceStatusScreenMode): boolean {
  return mode === "blocked" || mode === "error" || mode === "stopped";
}

function cloudStatusIcon(model: CloudWorkspaceStatusScreenModel) {
  if (model.mode === "pending") {
    return <LoaderCircle className="size-3 animate-spin" />;
  }
  return <CircleAlert className="size-3" />;
}

interface WorkspaceArrivalCloudPanelProps {
  model: CloudWorkspaceStatusScreenModel;
  isPrimaryActionPending: boolean;
  onPrimaryAction: (() => void) | null;
}

export function WorkspaceArrivalCloudPanel({
  model,
  isPrimaryActionPending,
  onPrimaryAction,
}: WorkspaceArrivalCloudPanelProps) {
  const compactView = buildCloudWorkspaceCompactStatusView(model);
  const [expanded, setExpanded] = useState(() => shouldExpandByDefault(model.mode));
  const previousModeRef = useRef(model.mode);

  useEffect(() => {
    if (shouldExpandByDefault(model.mode) && previousModeRef.current !== model.mode) {
      setExpanded(true);
    }
    previousModeRef.current = model.mode;
  }, [model.mode]);

  const primaryAction = compactView.primaryAction && onPrimaryAction
    ? {
      label: compactView.primaryAction.label,
      loading: isPrimaryActionPending,
      onClick: onPrimaryAction,
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
              loading={isPrimaryActionPending}
              onClick={onPrimaryAction ?? undefined}
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
    </ComposerAttachedPanel>
  );
}
