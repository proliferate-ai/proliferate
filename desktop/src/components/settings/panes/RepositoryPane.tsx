import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { LocalRepoSection } from "./repo/LocalRepoSection";
import { CloudRepoSection } from "./repo/CloudRepoSection";

interface RepositoryPaneProps {
  repository: SettingsRepositoryEntry | null;
}

export function RepositoryPane({ repository }: RepositoryPaneProps) {
  if (!repository) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader title="Repository" />
        <p className="text-sm text-muted-foreground">
          No local repositories are available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={repository.name}
        description={`Local settings stay on this machine. Cloud settings are saved for cloud workspaces. ${repository.secondaryLabel ?? repository.sourceRoot}`}
      />

      <LocalRepoSection repository={repository} />
      <CloudRepoSection repository={repository} />
    </section>
  );
}
