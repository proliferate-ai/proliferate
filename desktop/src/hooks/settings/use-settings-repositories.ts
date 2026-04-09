import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import {
  buildSettingsRepositoryEntries,
} from "@/lib/domain/settings/repositories";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useSettingsRepositories() {
  const { data: workspaceCollections } = useWorkspaces();
  const localWorkspaces = workspaceCollections?.localWorkspaces ?? EMPTY_WORKSPACES;

  const repositories = useMemo(
    () => buildSettingsRepositoryEntries(localWorkspaces),
    [localWorkspaces],
  );

  return {
    repositories,
  };
}
