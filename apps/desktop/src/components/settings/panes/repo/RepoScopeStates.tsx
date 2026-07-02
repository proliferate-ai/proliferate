import { Folder, Laptop } from "lucide-react";
import { parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { type RepoSettingsContext } from "@/lib/domain/settings/repo-scope-selection";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  useAddRepoFlowStore,
  type AddRepoFlowCompletion,
} from "@/stores/ui/add-repo-flow-store";

export interface RepoScopeSelectionCallbacks {
  onSelectRepo: (sourceRoot: string) => void;
  onSelectCloudEnvironment: (gitOwner: string, gitRepoName: string) => void;
}

/** Prop shape shared by the repo-scope settings panes (Configure / Actions). */
export interface RepoScopePaneProps extends RepoScopeSelectionCallbacks {
  repository: SettingsRepositoryEntry | null;
  context: RepoSettingsContext;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}

/** Unified add-repo flow completion → select the repo that was just added. */
function buildAddRepoCompletionHandler({
  onSelectRepo,
  onSelectCloudEnvironment,
}: RepoScopeSelectionCallbacks) {
  return (completion: AddRepoFlowCompletion) => {
    if (completion.kind === "local") {
      onSelectRepo(completion.sourceRoot);
      return;
    }
    const parsed = parseGitRepoId(completion.repoId);
    if (parsed) {
      onSelectCloudEnvironment(parsed.gitOwner, parsed.gitRepoName);
    }
  };
}

/** Repo scope with zero repositories — every repo-scope pane renders this. */
export function RepoScopeEmptyState(callbacks: RepoScopeSelectionCallbacks) {
  const openFlow = useAddRepoFlowStore((state) => state.openFlow);
  return (
    <SettingsEmptyState
      icon={<Folder aria-hidden="true" />}
      title="No repositories yet"
      description="Add a local checkout or a GitHub repo that runs in Proliferate Cloud."
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => openFlow({ onCompleted: buildAddRepoCompletionHandler(callbacks) })}
        >
          Add repository
        </Button>
      }
    />
  );
}

/** Local side of a cloud-only repo: no checkout on this machine to configure. */
export function LocalNoCheckoutState({
  repository,
  ...callbacks
}: RepoScopeSelectionCallbacks & {
  repository: SettingsRepositoryEntry;
}) {
  const openFlow = useAddRepoFlowStore((state) => state.openFlow);
  const repoLabel = repository.gitOwner && repository.gitRepoName
    ? `${repository.gitOwner}/${repository.gitRepoName}`
    : repository.name;
  return (
    <SettingsEmptyState
      icon={<Laptop aria-hidden="true" />}
      title="No local checkout on this machine"
      description={`Clone ${repoLabel} locally, then link the folder to configure local settings.`}
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => openFlow({ onCompleted: buildAddRepoCompletionHandler(callbacks) })}
        >
          Link local folder…
        </Button>
      }
    />
  );
}
