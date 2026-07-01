import {
  useMobileGitRepositories,
  useSaveMobileRepoConfig,
} from "../../access/cloud/repositories/use-mobile-repositories";
import { useMobileRepositoryPickerOptions } from "../derived/use-mobile-repository-picker-options";
import { useMobileRepositoryPickerState } from "../ui/use-mobile-repository-picker-state";

export function useMobileRepositoryPicker({
  configuredKeys,
  visible,
  onSaved,
  onClose,
}: {
  configuredKeys: ReadonlySet<string>;
  visible: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const repos = useMobileGitRepositories(visible);
  const save = useSaveMobileRepoConfig();
  const pickerState = useMobileRepositoryPickerState(visible);
  const available = useMobileRepositoryPickerOptions({
    configuredKeys,
    query: pickerState.query,
    repositories: repos.data?.repositories ?? [],
  });

  async function pickRepository(
    gitOwner: string,
    gitRepoName: string,
    defaultBranch: string | null,
  ): Promise<void> {
    const key = `${gitOwner}/${gitRepoName}`;
    pickerState.setBusyKey(key);
    pickerState.setError(null);
    try {
      await save.mutateAsync({
        gitOwner,
        gitRepoName,
        body: {
          kind: "cloud",
          gitProvider: "github",
          defaultBranch,
          setupScript: "",
          runCommand: "",
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      pickerState.setError(err instanceof Error ? err.message : "Could not save repository.");
    } finally {
      pickerState.setBusyKey(null);
    }
  }

  return {
    available,
    busyKey: pickerState.busyKey,
    error: pickerState.error,
    pickRepository,
    query: pickerState.query,
    repos,
    setQuery: pickerState.setQuery,
  };
}
