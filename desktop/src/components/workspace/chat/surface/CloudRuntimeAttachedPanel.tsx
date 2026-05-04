import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { CloudStatusCompactHeader } from "@/components/workspace/chat/surface/CloudStatusCompactHeader";
import { CircleAlert, LoaderCircle } from "@/components/ui/icons";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import type { SelectedCloudRuntimeViewModel } from "@/lib/domain/workspaces/cloud-runtime-state";

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

export function CloudRuntimeAttachedPanel() {
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const state = selectedCloudRuntime.state;

  if (!state || state.phase === "ready" || !state.title || !state.subtitle) {
    return null;
  }

  return (
    <CloudRuntimeAttachedPanelView
      state={state}
      retry={selectedCloudRuntime.retry}
    />
  );
}

export function CloudRuntimeAttachedPanelView({
  retry,
  state,
}: {
  retry: (() => void) | null;
  state: SelectedCloudRuntimeViewModel;
}) {
  const isAttention = state.phase === "failed";
  const [expanded, setExpanded] = useState(isAttention);
  const previousPhaseRef = useRef(state.phase);

  useEffect(() => {
    if (state.phase === "failed" && previousPhaseRef.current !== state.phase) {
      setExpanded(true);
    }
    previousPhaseRef.current = state.phase;
  }, [state.phase]);

  const tone = state.tone === "error" ? "destructive" : "info";
  const primaryAction = state.showRetry && retry
    ? {
      label: "Retry",
      onClick: retry,
    }
    : null;

  return (
    <ComposerAttachedPanel
      header={(
        <CloudStatusCompactHeader
          title={state.title ?? "Cloud workspace"}
          phaseLabel={state.subtitle ?? "Reconnecting runtime"}
          tone={tone}
          statusIcon={state.phase === "resuming"
            ? <LoaderCircle className="size-3 animate-spin" />
            : <CircleAlert className="size-3" />}
          primaryAction={primaryAction}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((value) => !value)}
        />
      )}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
    >
      <div className="max-h-[min(32vh,280px)] overflow-y-auto">
        <SectionRow label="Status">
          <span className="text-base text-muted-foreground">
            {state.actionBlockReason}
          </span>
        </SectionRow>
        {state.showRetry && retry && (
          <SectionRow label="Actions">
            <Button
              size="sm"
              onClick={() => {
                retry?.();
              }}
            >
              Retry
            </Button>
          </SectionRow>
        )}
      </div>
    </ComposerAttachedPanel>
  );
}
