import { useState } from "react";
import { useClaimCloudWorkspace } from "@proliferate/cloud-sdk-react";

import type { MobileWorkItem } from "../derived/use-mobile-work-inventory";

export function useMobileWorkClaimActions() {
  const [claimingWorkspaceId, setClaimingWorkspaceId] = useState<string | null>(null);
  const claimWorkspace = useClaimCloudWorkspace();

  async function claimListWorkspace(item: MobileWorkItem): Promise<void> {
    if (!item.view.unclaimed || claimingWorkspaceId) {
      return;
    }
    setClaimingWorkspaceId(item.workspace.id);
    try {
      await claimWorkspace.mutateAsync({ workspaceId: item.workspace.id });
    } finally {
      setClaimingWorkspaceId(null);
    }
  }

  return {
    claimListWorkspace,
    claimingWorkspaceId,
  };
}
