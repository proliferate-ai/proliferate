export interface RepoRemovalConfirmationCopy {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: "destructive";
}

export function repoRemovalConfirmationCopy(
  repoName: string,
  removesCloud = false,
): RepoRemovalConfirmationCopy {
  return {
    title: "Remove repository?",
    description: removesCloud
      ? `Remove ${repoName} from Cloud and this sidebar. Local files and workspaces are not deleted.`
      : `Remove ${repoName} from the sidebar. Local files and workspaces are not deleted.`,
    confirmLabel: "Remove repository",
    confirmVariant: "destructive",
  };
}

export function requestRepoRemovalConfirmation(openConfirmation: () => void) {
  openConfirmation();
}

export async function confirmRepoRemoval({
  closeConfirmation,
  removeRepo,
}: {
  closeConfirmation: () => void;
  removeRepo?: () => Promise<void> | void;
}) {
  await removeRepo?.();
  closeConfirmation();
}
