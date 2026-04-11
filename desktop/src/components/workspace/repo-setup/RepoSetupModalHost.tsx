import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { RepoSetupModal } from "./RepoSetupModal";

export function RepoSetupModalHost() {
  const repoSetupModal = useRepoSetupModalStore((state) => state.modal);
  const closeRepoSetupModal = useRepoSetupModalStore((state) => state.close);

  if (!repoSetupModal) {
    return null;
  }

  return (
    <RepoSetupModal
      repoRootId={repoSetupModal.repoRootId}
      sourceRoot={repoSetupModal.sourceRoot}
      repoName={repoSetupModal.repoName}
      onClose={closeRepoSetupModal}
    />
  );
}
