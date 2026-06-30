import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";

export interface SecretDeleteDialogState {
  kind: "env" | "file";
  nameOrPath: string;
}

export interface SecretDeleteDialogProps {
  open: boolean;
  state: SecretDeleteDialogState | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SecretDeleteDialog({
  open,
  state,
  loading = false,
  onClose,
  onConfirm,
}: SecretDeleteDialogProps) {
  const label = state?.kind === "env" ? "environment variable" : "file secret";
  return (
    <ConfirmationDialog
      open={open}
      title="Delete secret"
      description={state ? `Delete ${label} ${state.nameOrPath}?` : "Delete this secret?"}
      confirmLabel="Delete"
      confirmVariant="destructive"
      loading={loading}
      disableClose={loading}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
