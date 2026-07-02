import { KeyRound } from "lucide-react";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { useCloudRepoEnvironmentEditor } from "@/hooks/settings/workflows/use-cloud-repo-environment-editor";
import { type RepoSettingsContext } from "@/lib/domain/settings/repo-scope-selection";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { RepoCloudGate } from "./RepoCloudGate";
import {
  RepoScopeEmptyState,
  type RepoScopePaneProps,
} from "./RepoScopeStates";

/**
 * Repo → Environment: variables and files synced into cloud workspaces for
 * this repo. The store is cloud-side only, so the Local context renders an
 * explanatory state instead of fake local controls; secret values are
 * write-only on the API (list returns name/size metadata), so the cloud side
 * uses the add/replace/delete secrets panel rather than editable value fields.
 */
export function RepoEnvironmentPane({
  repository,
  context,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
  onSelectRepo,
  onSelectCloudEnvironment,
  onSelectRepoContext,
}: RepoScopePaneProps & {
  onSelectRepoContext: (context: RepoSettingsContext) => void;
}) {
  if (!repository) {
    return (
      <RepoScopeEmptyState
        onSelectRepo={onSelectRepo}
        onSelectCloudEnvironment={onSelectCloudEnvironment}
      />
    );
  }
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Environment"
        description="Variables and files synced into cloud workspaces for this repo."
      />
      {context === "cloud" ? (
        <EnvironmentCloud
          repository={repository}
          cloudEnabled={cloudEnabled}
          cloudActive={cloudActive}
          cloudSignInChecking={cloudSignInChecking}
          cloudSignInAvailable={cloudSignInAvailable}
        />
      ) : (
        <EnvironmentLocal onSelectRepoContext={onSelectRepoContext} />
      )}
    </section>
  );
}

function EnvironmentCloud({
  repository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
}: {
  repository: SettingsRepositoryEntry;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}) {
  const editor = useCloudRepoEnvironmentEditor({ repository, cloudActive });
  const cloudRepository = editor.cloudRepository;

  return (
    <RepoCloudGate
      editor={editor}
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
    >
      {cloudRepository ? (
        <CloudSecretsSettingsSurface
          scope={{
            kind: "workspace",
            gitOwner: cloudRepository.gitOwner,
            gitRepoName: cloudRepository.gitRepoName,
          }}
          enabled={cloudActive}
        />
      ) : null}
    </RepoCloudGate>
  );
}

function EnvironmentLocal({
  onSelectRepoContext,
}: {
  onSelectRepoContext: (context: RepoSettingsContext) => void;
}) {
  return (
    <SettingsEmptyState
      icon={<KeyRound aria-hidden="true" />}
      title="No local environment store"
      description="Local workspaces read variables from your shell and checkout. Proliferate stores environment variables and files for cloud workspaces only."
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSelectRepoContext("cloud")}
        >
          View cloud variables
        </Button>
      }
    />
  );
}
