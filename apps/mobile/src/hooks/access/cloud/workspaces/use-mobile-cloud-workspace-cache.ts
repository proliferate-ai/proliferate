import { useCallback } from "react";

// The cloud workspace stack is deleted; there are no workspace-list queries
// left to invalidate.
export function useMobileCloudWorkspaceCache() {
  const invalidateWorkspaceLists = useCallback(() => {}, []);

  return { invalidateWorkspaceLists };
}
