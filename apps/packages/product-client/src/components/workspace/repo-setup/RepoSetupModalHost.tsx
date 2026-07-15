import { useRepoSetupModalStore } from "#product/stores/ui/repo-setup-modal-store";
import { RepoSetupModal } from "#product/components/workspace/repo-setup/RepoSetupModal";

export function RepoSetupModalHost() {
  const repoSetupModal = useRepoSetupModalStore((state) => state.modal);
  const closeRepoSetupModal = useRepoSetupModalStore((state) => state.close);

  if (!repoSetupModal) {
    return null;
  }

  return (
    <RepoSetupModal
      sourceRoot={repoSetupModal.sourceRoot}
      repoName={repoSetupModal.repoName}
      onClose={closeRepoSetupModal}
    />
  );
}
