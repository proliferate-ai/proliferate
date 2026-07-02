import { Cloud, Laptop } from "lucide-react";
import { parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { RepoPicker } from "@proliferate/product-ui/settings/RepoPicker";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { type SettingsFocus } from "@/lib/domain/settings/navigation";
import {
  resolveRepoScopeSelection,
  type RepoSettingsContext,
} from "@/lib/domain/settings/repo-scope-selection";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";

interface RepoScopeHeaderControlsProps {
  repositories: SettingsRepositoryEntry[];
  activeRepoSourceRoot: string | null;
  focus: SettingsFocus;
  onSelectRepo: (sourceRoot: string) => void;
  onSelectRepoContext: (context: RepoSettingsContext) => void;
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void;
}

/**
 * Right slot of the settings scope-tab bar, Repo scope only: the repo picker
 * plus the Cloud|Local context toggle (design-system Bench repo header slot).
 * Renders nothing while there are no repositories — the panes own that empty
 * state.
 */
export function RepoScopeHeaderControls({
  repositories,
  activeRepoSourceRoot,
  focus,
  onSelectRepo,
  onSelectRepoContext,
  onSelectCloudEnvironment,
}: RepoScopeHeaderControlsProps) {
  const openFlow = useAddRepoFlowStore((state) => state.openFlow);
  if (repositories.length === 0) {
    return null;
  }
  const { repository, context } = resolveRepoScopeSelection({
    repositories,
    activeRepoSourceRoot,
    focus,
  });
  return (
    <>
      <RepoPicker
        items={repositories.map((entry) => ({
          id: entry.sourceRoot,
          name: entry.name,
          detail: entry.secondaryLabel,
          kind: entry.availability === "cloud" ? "cloud" : "local",
        }))}
        value={repository?.sourceRoot ?? null}
        onSelect={onSelectRepo}
        onAddRepository={() => {
          openFlow({
            onCompleted: (completion) => {
              if (completion.kind === "local") {
                onSelectRepo(completion.sourceRoot);
                return;
              }
              const parsed = parseGitRepoId(completion.repoId);
              if (parsed) {
                onSelectCloudEnvironment(parsed.gitOwner, parsed.gitRepoName);
              }
            },
          });
        }}
      />
      <SegmentedControl
        ariaLabel="Repository settings context"
        value={context}
        items={[
          { id: "cloud", label: "Cloud", icon: <Cloud /> },
          { id: "local", label: "Local", icon: <Laptop /> },
        ]}
        onChange={onSelectRepoContext}
      />
    </>
  );
}
