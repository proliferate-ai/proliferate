import { CloudRepoPickerDialog } from "@proliferate/product-ui/repos/CloudRepoPicker";
import { useAddCloudEnvironment } from "./use-add-cloud-environment";

interface AddCloudEnvironmentDialogControllerProps {
  open: boolean;
  organizationId?: string | null;
  canManageGitHubAppInstallation?: boolean;
  userAuthorizationReturnTo?: string | null;
  installationReturnTo?: string | null;
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  onClose: () => void;
  onEnvironmentAdded: (repoId: string) => void;
}

/**
 * Standalone add-cloud-environment dialog for surfaces without the unified
 * AddRepoFlow (web home / web settings). Desktop reaches the same wiring
 * through AddRepoFlow's cloud step via useAddCloudEnvironment directly.
 */
export function AddCloudEnvironmentDialogController({
  open,
  organizationId = null,
  canManageGitHubAppInstallation = false,
  userAuthorizationReturnTo = null,
  installationReturnTo = null,
  onOpenExternalUrl,
  onClose,
  onEnvironmentAdded,
}: AddCloudEnvironmentDialogControllerProps) {
  const picker = useAddCloudEnvironment({
    enabled: open,
    organizationId,
    canManageGitHubAppInstallation,
    userAuthorizationReturnTo,
    installationReturnTo,
    onOpenExternalUrl,
    onEnvironmentAdded: (repoId) => {
      onEnvironmentAdded(repoId);
      onClose();
    },
  });

  return (
    <CloudRepoPickerDialog
      open={open}
      onClose={onClose}
      {...picker}
    />
  );
}
