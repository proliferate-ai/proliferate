import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight, Folder } from "@/components/ui/icons";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { LocalRepoSection } from "./repo/LocalRepoSection";
import { CloudRepoSection } from "./repo/CloudRepoSection";
import { AutomaticSyncSection } from "./environments/AutomaticSyncSection";
import { WorktreeStorageSection } from "./environments/WorktreeStorageSection";

interface EnvironmentsPaneProps {
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
  onSelectRepository: (sourceRoot: string) => void;
  onBackToList: () => void;
}

function RepositoryIdentityRow({
  repository,
  action,
}: {
  repository: SettingsRepositoryEntry;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Folder className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-medium text-foreground">
            {repository.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {repository.secondaryLabel ?? repository.sourceRoot}
          </div>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EnvironmentsPane({
  repositories,
  selectedRepository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
  onSelectRepository,
  onBackToList,
}: EnvironmentsPaneProps) {
  if (!selectedRepository) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title="Environments"
          description="Per-repo configuration for local worktrees and personal cloud workspaces."
        />

        <EnvironmentSection
          title="Your repositories"
          description="Click a repository to configure its environment."
        >
          <EnvironmentPanel>
            {repositories.length === 0 ? (
              <EnvironmentPanelRow>
                <p className="text-sm text-muted-foreground">
                  No local environments are available yet.
                </p>
              </EnvironmentPanelRow>
            ) : (
              repositories.map((repository) => (
                <EnvironmentPanelRow key={`${repository.sourceRoot}:${repository.repoRootId}`}>
                  <RepositoryIdentityRow
                    repository={repository}
                    action={(
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onSelectRepository(repository.sourceRoot)}
                        className="px-2"
                      >
                        Configure
                        <ChevronRight className="size-4" />
                      </Button>
                    )}
                  />
                </EnvironmentPanelRow>
              ))
            )}
          </EnvironmentPanel>
      </EnvironmentSection>
      <AutomaticSyncSection repositories={repositories} />
      <WorktreeStorageSection />
    </section>
  );
}

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBackToList}
          className="h-auto px-0 py-0 text-sm hover:bg-transparent"
        >
          Environments
          <ChevronRight className="size-4" />
          <span className="text-foreground">{selectedRepository.name}</span>
        </Button>
        <SettingsPageHeader title="Environments" />
        <EnvironmentPanel>
          <EnvironmentPanelRow>
            <RepositoryIdentityRow repository={selectedRepository} />
          </EnvironmentPanelRow>
        </EnvironmentPanel>
      </div>

      <LocalRepoSection repository={selectedRepository} />
      <CloudRepoSection
        repository={selectedRepository}
        cloudEnabled={cloudEnabled}
        cloudActive={cloudActive}
        cloudSignInChecking={cloudSignInChecking}
        cloudSignInAvailable={cloudSignInAvailable}
      />
    </section>
  );
}
