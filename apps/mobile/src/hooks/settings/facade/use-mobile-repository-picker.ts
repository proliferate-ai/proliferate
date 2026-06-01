import { useEffect, useMemo, useState } from "react";
import {
  useCloudGitRepositories,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";

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
  const repos = useCloudGitRepositories({}, visible);
  const save = useSaveCloudRepoConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const available = useMemo(() => {
    const all = (repos.data?.repositories ?? []).filter(
      (repo) => !configuredKeys.has(`${repo.gitOwner}/${repo.gitRepoName}`),
    );
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return all;
    }
    return all.filter((repo) => repo.fullName.toLowerCase().includes(normalizedQuery));
  }, [repos.data, configuredKeys, query]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setError(null);
    }
  }, [visible]);

  async function pickRepository(
    gitOwner: string,
    gitRepoName: string,
    defaultBranch: string | null,
  ): Promise<void> {
    const key = `${gitOwner}/${gitRepoName}`;
    setBusyKey(key);
    setError(null);
    try {
      await save.mutateAsync({
        gitOwner,
        gitRepoName,
        body: {
          configured: true,
          defaultBranch,
          envVars: {},
          setupScript: "",
          runCommand: "",
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save repository.");
    } finally {
      setBusyKey(null);
    }
  }

  return {
    available,
    busyKey,
    error,
    pickRepository,
    query,
    repos,
    setQuery,
  };
}
