export interface RepoRemovalConfirmationCopy {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: "destructive";
}

export function repoRemovalConfirmationCopy(repoName: string): RepoRemovalConfirmationCopy {
  return {
    title: "Remove repository?",
    description: `Remove ${repoName} from the sidebar. Local files and workspaces are not deleted.`,
    confirmLabel: "Remove repository",
    confirmVariant: "destructive",
  };
}

export function requestRepoRemovalConfirmation(openConfirmation: () => void) {
  openConfirmation();
}

export function confirmRepoRemoval({
  closeConfirmation,
  removeRepo,
}: {
  closeConfirmation: () => void;
  removeRepo?: () => void;
}) {
  closeConfirmation();
  removeRepo?.();
}
