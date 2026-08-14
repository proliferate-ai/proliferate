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
  /**
   * The user has been sent to GitHub and the flow is parked until they come
   * back. Rendered INSTEAD of the checklist + CTA: at that point the checklist
   * can only restate what GitHub is already showing, and the one thing the
   * surface still owns is "tell me when you're done" (see
   * `buildGitHubWaitingView`). Manual re-check only — no auto-polling.
   */
  waiting?: CloudRepoPickerWaitingView | null;
}

export interface CloudRepoPickerSetupStepView {
  label: string;
  description: string;
  status: "complete" | "current" | "upcoming";
}

/** Parked-on-GitHub panel: what we asked for, and the way back. */
export interface CloudRepoPickerWaitingView {
  title: string;
  description: string;
  /**
   * The admin request that was copied to the clipboard, shown inline so the
   * non-privileged path can see what it is about to paste. Null on the paths
   * where the user acts on GitHub themselves.
   */
  requestText?: string | null;
  checkAgainLabel: string;
  checking?: boolean;
  onCheckAgain: () => void;
  onCancel: () => void;
}

export interface CloudRepoPickerProps {
  query: string;
  manualValue: string;
  repositories: readonly CloudRepoPickerRepositoryView[];
  blocker?: CloudRepoPickerBlockerView | null;
  /**
   * Confirmation on arrival: when the user reaches the picker by finishing the
   * GitHub setup checklist, the picker leads with a success banner instead of
   * dropping them into an unexplained list. Null on every other entry.
   */
  connectedBanner?: string | null;
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
