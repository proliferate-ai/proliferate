export function useWebCloudWorkspaceActions() {
  async function claimCurrentWorkspace() {
    return;
  }

  async function copyComposerFooterValue(value: string, label: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      console.warn(`${label} could not be copied.`);
      return false;
    }
  }

  return {
    claimCurrentWorkspace,
    copyComposerFooterValue,
  };
}
