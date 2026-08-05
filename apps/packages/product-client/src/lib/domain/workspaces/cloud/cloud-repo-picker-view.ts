export type CloudRepoConfigState = "missing" | "disabled" | "configured";

export interface CloudRepoPickerRepositoryView {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  permission: string | null;
  configured: boolean;
  repoConfigState: CloudRepoConfigState;
  ownerAvatarUrl?: string | null;
  pushedAt?: string | null;
  updatedAt?: string | null;
  disabledReason?: string | null;
}

/** GitHub App prerequisite (authorize / install / org missing) blocking the picker. */
export interface CloudRepoPickerBlockerView {
  title: string;
  description: string;
  steps?: readonly CloudRepoPickerSetupStepView[];
  actionLabel?: string | null;
  actionLoading?: boolean;
  onAction?: (() => void) | null;
}

export interface CloudRepoPickerSetupStepView {
  label: string;
  description: string;
  status: "complete" | "current" | "upcoming";
}

export interface CloudRepoPickerProps {
  query: string;
  manualValue: string;
  repositories: readonly CloudRepoPickerRepositoryView[];
  blocker?: CloudRepoPickerBlockerView | null;
  loading?: boolean;
  loadingMore?: boolean;
  addingRepoId?: string | null;
  error?: string | null;
  nextCursor?: string | null;
  onQueryChange: (value: string) => void;
  onManualValueChange: (value: string) => void;
  onAddRepository: (repo: CloudRepoPickerRepositoryView) => void;
  onAddManual: () => void;
  onLoadMore: () => void;
  onRetry?: () => void;
}

export interface CloudRepoPickerDialogProps extends CloudRepoPickerProps {
  open: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
}
