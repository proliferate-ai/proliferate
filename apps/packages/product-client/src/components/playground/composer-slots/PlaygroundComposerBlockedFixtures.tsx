import type { ReactNode } from "react";
import { ChatComposerSurface } from "#product/components/workspace/chat/composer/ChatComposerSurface";
import { ComposerTextareaFrame } from "#product/primitives/patterns/ComposerTextareaFrame";
import { ComposerBlockedStatusLine } from "#product/components/workspace/chat/input/ComposerBlockedStatusLine";
import { ComposerBlockedControlRow } from "#product/components/workspace/chat/input/ComposerBlockedControlRow";
import {
  composeBlockedStatusMessage,
  presentComposerBlockedState,
  resolveComposerBlockedState,
  type ComposerBlockedState,
  type ComposerBlockedCloudStatusInput,
} from "#product/lib/domain/chat/composer/composer-blocked-state";
import type { CloudWorkspaceStatusScreenModel } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { buildCloudWorkspaceCompactStatusView } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import type { ScenarioKey } from "#product/config/playground";
import {
  CLOUD_RUNTIME_RECONNECT_ERROR,
  CLOUD_RUNTIME_RECONNECTING,
  CLOUD_STATUS_APPLYING_FILES,
  CLOUD_STATUS_BLOCKED,
  CLOUD_STATUS_ERROR,
  CLOUD_STATUS_FIRST_RUNTIME,
  CLOUD_STATUS_PROVISIONING,
} from "#product/lib/domain/chat/__fixtures__/playground/panel-cloud-fixtures";
import { noop } from "#product/components/playground/PlaygroundComposerActions";

/**
 * Composer takeover fixtures (Blocked Status design): renders the same
 * blocked-status kinds `useComposerBlockedState` maps in production, but
 * from static fixture models instead of live hooks — mirrors the retired
 * workspace-status / cloud-runtime panel fixtures, now hosted in the
 * composer's own textarea frame instead of an attached panel.
 */
export function renderComposerBlockedSurface(scenario: ScenarioKey): ReactNode | null {
  const state = composerBlockedStateForScenario(scenario);
  if (!state) {
    return null;
  }
  const presentation = presentComposerBlockedState(state);
  return (
    <ChatComposerSurface overflowMode="clip">
      <form className="relative flex flex-col">
        <ComposerTextareaFrame topInset="standard">
          <ComposerBlockedStatusLine
            icon={presentation.icon}
            tone={presentation.tone}
            message={presentation.message}
          />
        </ComposerTextareaFrame>
        <ComposerBlockedControlRow
          actions={presentation.actions}
          disabledReason={presentation.message}
          isRunning={false}
          isEmpty
          onSubmit={noop}
          onCancel={noop}
        />
      </form>
    </ChatComposerSurface>
  );
}

const idleAction = { onSelect: noop, loading: false, disabled: false };

/** Mirrors the `cloudStatus` bucket construction in `useComposerBlockedState`,
 * driven off a static fixture model instead of `useWorkspaceStatusPanelState`. */
function cloudStatusInput(model: CloudWorkspaceStatusScreenModel): ComposerBlockedCloudStatusInput {
  const view = buildCloudWorkspaceCompactStatusView(model);
  return {
    mode: model.mode,
    message: composeBlockedStatusMessage(model.mode, model.title, model.description),
    primaryActionLabel: view.primaryAction?.label ?? null,
    primaryAction: view.primaryAction ? idleAction : null,
    primaryActionConfirmation:
      model.footer.kind === "action" && model.footer.action === "delete"
        ? {
          title: "Delete lost workspace?",
          description:
            "Remove this workspace record. Anything pushed to GitHub, including commits, branches, and pull requests, remains available.",
          confirmLabel: "Delete",
        }
        : null,
  };
}

function composerBlockedStateForScenario(scenario: ScenarioKey): ComposerBlockedState | null {
  switch (scenario) {
    case "worktree-missing":
      return resolveComposerBlockedState({
        directoryMissing: {
          workspaceKind: "worktree",
          restoreEligible: true,
          restoreError: null,
          checkAgain: idleAction,
          restore: idleAction,
        },
        provisioningFailed: null,
        cloudStatus: null,
        cloudRuntime: null,
      });
    case "cloud-first-runtime":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: cloudStatusInput(CLOUD_STATUS_FIRST_RUNTIME),
        cloudRuntime: null,
      });
    case "cloud-provisioning":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: cloudStatusInput(CLOUD_STATUS_PROVISIONING),
        cloudRuntime: null,
      });
    case "cloud-applying-files":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: cloudStatusInput(CLOUD_STATUS_APPLYING_FILES),
        cloudRuntime: null,
      });
    case "cloud-blocked":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: cloudStatusInput(CLOUD_STATUS_BLOCKED),
        cloudRuntime: null,
      });
    case "cloud-error":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: cloudStatusInput(CLOUD_STATUS_ERROR),
        cloudRuntime: null,
      });
    case "cloud-reconnecting":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: null,
        cloudRuntime: {
          phase: CLOUD_RUNTIME_RECONNECTING.phase,
          message: CLOUD_RUNTIME_RECONNECTING.actionBlockReason ?? CLOUD_RUNTIME_RECONNECTING.subtitle ?? "",
          retry: null,
          claim: null,
        },
      });
    case "cloud-reconnect-error":
      return resolveComposerBlockedState({
        directoryMissing: null,
        provisioningFailed: null,
        cloudStatus: null,
        cloudRuntime: {
          phase: CLOUD_RUNTIME_RECONNECT_ERROR.phase,
          message: CLOUD_RUNTIME_RECONNECT_ERROR.actionBlockReason ?? CLOUD_RUNTIME_RECONNECT_ERROR.subtitle ?? "",
          retry: idleAction,
          claim: null,
        },
      });
    default:
      return null;
  }
}
