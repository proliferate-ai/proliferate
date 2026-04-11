import type { Workspace } from "@anyharness/sdk";
import { useRuntimeWorkspacesQuery } from "@anyharness/sdk-react";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useCoworkWorkspaces() {
  const query = useRuntimeWorkspacesQuery({ surfaceKind: "cowork" });

  return {
    ...query,
    data: query.data ?? EMPTY_WORKSPACES,
  };
}
