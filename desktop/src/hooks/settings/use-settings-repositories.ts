import { useMemo } from "react";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import {
  buildSettingsRepositoryEntries,
} from "@/lib/domain/settings/repositories";

const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_REPO_ROOTS: RepoRoot[] = [];

export function useSettingsRepositories() {
  const { data: workspaceCollections } = useWorkspaces();
  const localWorkspaces = workspaceCollections?.localWorkspaces ?? EMPTY_WORKSPACES;
  const repoRoots = workspaceCollections?.repoRoots ?? EMPTY_REPO_ROOTS;

  const repositories = useMemo(
    () => buildSettingsRepositoryEntries(localWorkspaces, repoRoots),
    [localWorkspaces, repoRoots],
  );

  return {
    repositories,
  };
}
