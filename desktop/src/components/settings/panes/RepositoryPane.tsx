import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { LocalRepoSection } from "./repo/LocalRepoSection";
import { CloudRepoSection } from "./repo/CloudRepoSection";

interface RepositoryPaneProps {
  repository: SettingsRepositoryEntry | null;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}

export function RepositoryPane({
  repository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
}: RepositoryPaneProps) {
  if (!repository) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader title="Environment" />
        <p className="text-sm text-muted-foreground">
          No local environments are available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={repository.name}
        description={`Local environment settings stay on this machine. Cloud environment settings are saved for cloud workspaces. ${repository.secondaryLabel ?? repository.sourceRoot}`}
      />

      <LocalRepoSection repository={repository} />
      <CloudRepoSection
        repository={repository}
        cloudEnabled={cloudEnabled}
        cloudActive={cloudActive}
        cloudSignInChecking={cloudSignInChecking}
        cloudSignInAvailable={cloudSignInAvailable}
      />
    </section>
  );
}
