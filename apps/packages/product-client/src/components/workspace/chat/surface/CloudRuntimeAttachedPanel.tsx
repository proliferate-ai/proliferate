import { useEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ComposerAttachedPanel,
  ComposerAttachedPanelRow,
} from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import { CloudStatusCompactHeader } from "#product/components/workspace/chat/surface/CloudStatusCompactHeader";
import { CircleAlert, Spinner } from "@proliferate/ui/icons";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import type { SelectedCloudRuntimeViewModel } from "#product/lib/domain/workspaces/cloud/cloud-runtime-state";

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
      claim={selectedCloudRuntime.claim}
      claimPending={selectedCloudRuntime.claimPending}
    />
  );
}

export function CloudRuntimeAttachedPanelView({
  claim,
  claimPending = false,
  retry,
  state,
}: {
  claim?: (() => void) | null;
  claimPending?: boolean;
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
  const claimAction = selectedActionForClaim(state, claim ?? null, claimPending);
  const primaryAction = claimAction
    ? claimAction
    : state.showRetry && retry
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
            ? <Spinner className="icon-compact" />
            : <CircleAlert className="icon-compact" />}
          primaryAction={primaryAction}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((value) => !value)}
        />
      )}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
    >
      <div className="max-h-[min(32vh,280px)] overflow-y-auto">
        <ComposerAttachedPanelRow label="Status">
          <span className="text-base text-muted-foreground">
            {state.actionBlockReason}
          </span>
        </ComposerAttachedPanelRow>
        {state.showRetry && retry && (
          <ComposerAttachedPanelRow label="Actions">
            <Button
              size="sm"
              onClick={() => {
                retry?.();
              }}
            >
              Retry
            </Button>
          </ComposerAttachedPanelRow>
        )}
        {state.showClaim && claimAction && (
          <ComposerAttachedPanelRow label="Actions">
            <Button
              size="sm"
              loading={claimAction.loading}
              onClick={() => {
                claimAction.onClick();
              }}
            >
              {claimAction.label}
            </Button>
          </ComposerAttachedPanelRow>
        )}
      </div>
    </ComposerAttachedPanel>
  );
}

function selectedActionForClaim(
  state: SelectedCloudRuntimeViewModel,
  claim: (() => void) | null,
  loading: boolean,
) {
  return state.showClaim && claim
    ? {
      label: "Claim",
      loading,
      onClick: claim,
    }
    : null;
}
