import type { MobileWorkItem } from "../derived/use-mobile-work-inventory";

export function useMobileWorkClaimActions() {
  async function claimListWorkspace(item: MobileWorkItem): Promise<void> {
    void item;
  }

  return {
    claimListWorkspace,
    claimingWorkspaceId: null,
  };
}
