import { KeyRound } from "lucide-react";
import { SecretManagementPanel } from "@proliferate/product-ui/patterns/secrets/SecretManagementPanel";
import { SettingsEmptyState } from "@proliferate/product-ui/patterns/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/patterns/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { useCloudSecretsPanel } from "#product/hooks/access/cloud/use-cloud-secrets-panel";
import { useCloudRepoEnvironmentEditor } from "#product/hooks/settings/workflows/use-cloud-repo-environment-editor";
import { type RepoSettingsContext } from "#product/lib/domain/settings/repo-scope-selection";
import { type SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import { RepoCloudGate } from "#product/components/settings/panes/repo/RepoCloudGate";
import {
  RepoScopeEmptyState,
  type RepoScopePaneProps,
} from "#product/components/settings/panes/repo/RepoScopeStates";

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
    <section className="space-y-5">
      <SettingsPageHeader
        title="Environment"
        description="Variables and files synced to this repo's cloud workspaces."
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
        <RepoEnvironmentSecretsPanel
          gitOwner={cloudRepository.gitOwner}
          gitRepoName={cloudRepository.gitRepoName}
          enabled={cloudActive}
        />
      ) : null}
    </RepoCloudGate>
  );
}

function RepoEnvironmentSecretsPanel({
  gitOwner,
  gitRepoName,
  enabled,
}: {
  gitOwner: string;
  gitRepoName: string;
  enabled: boolean;
}) {
  const panel = useCloudSecretsPanel({
    scope: { kind: "workspace", gitOwner, gitRepoName },
    enabled,
  });

  return <SecretManagementPanel {...panel} />;
}

function EnvironmentLocal({
  onSelectRepoContext,
}: {
  onSelectRepoContext: (context: RepoSettingsContext) => void;
}) {
  return (
    <SettingsEmptyState
      icon={<KeyRound aria-hidden="true" />}
      title="Cloud only"
      description="Local workspaces inherit variables from your shell and checkout; managed variables and files are available in Cloud."
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSelectRepoContext("cloud")}
        >
          View Cloud environment
        </Button>
      }
    />
  );
}
