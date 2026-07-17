import {
  useMobileGitRepositories,
  useSaveMobileRepoConfig,
} from "../../access/cloud/repositories/use-mobile-repositories";
import { useMobileCloudRepoReadiness } from "../../access/cloud/repositories/use-mobile-cloud-repo-readiness";
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
  // List-level readiness gate: resolve deployment -> sign-in -> user App auth
  // -> installation -> coverage before the repository picker lists or saves.
  const readiness = useMobileCloudRepoReadiness({ enabled: visible });
  // Only list / list-save once every list-level gate is met.
  const gatesReady = readiness.blocker === null && !readiness.checking;

  const repos = useMobileGitRepositories(visible && gatesReady);
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
    // Defense in depth: never save while a gate is unmet.
    if (!gatesReady) {
      return;
    }
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
    gatesReady,
    pickRepository,
    query: pickerState.query,
    readiness,
    repos,
    setQuery: pickerState.setQuery,
  };
}
