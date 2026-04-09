import { CloudWorkspaceEnvVarsCard } from "./CloudWorkspaceEnvVarsCard";
import { CloudWorkspaceSavedScriptCard } from "./CloudWorkspaceSavedScriptCard";
import { CloudWorkspaceSettingsSummaryCard } from "./CloudWorkspaceSettingsSummaryCard";
import { CloudWorkspaceTrackedFilesCard } from "./CloudWorkspaceTrackedFilesCard";
import { useCloudWorkspaceSettingsPanelState } from "@/hooks/cloud/use-cloud-workspace-settings-panel-state";

export function CloudWorkspaceSettingsPanel() {
  const state = useCloudWorkspaceSettingsPanelState();

  if (state.kind === "placeholder") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-xs space-y-2">
          <p className="text-sm font-medium text-foreground">Cloud settings live here</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Select a cloud workspace to review tracked files, setup state, and repo cloud configuration.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-sidebar-background p-3" data-telemetry-block>
      <div className="space-y-3">
        <CloudWorkspaceSettingsSummaryCard
          repoLabel={state.repoLabel}
          filesOutOfSync={state.filesOutOfSync}
          repoFilesAppliedVersion={state.repoFilesAppliedVersion}
          currentRepoFilesVersion={state.currentRepoFilesVersion}
          postReadyLabel={state.postReadyLabel}
          postReadyProgress={state.postReadyProgress}
          setupStatusLabel={state.setupStatusLabel}
          errorMessage={state.errorMessage}
          isResyncingFiles={state.isResyncingFiles}
          isResyncingCredentials={state.isResyncingCredentials}
          isRunningSetup={state.isRunningSetup}
          canRunSetup={state.canRunSetup}
          onResyncFiles={state.onResyncFiles}
          onResyncCredentials={state.onResyncCredentials}
          onRunSetup={state.onRunSetup}
          onConfigureRepo={state.navigateToRepoSettings}
        />

        <CloudWorkspaceTrackedFilesCard trackedFiles={state.trackedFiles} />
        <CloudWorkspaceEnvVarsCard envVarKeys={state.envVarKeys} />
        <CloudWorkspaceSavedScriptCard setupScript={state.setupScript} />
      </div>
    </div>
  );
}
