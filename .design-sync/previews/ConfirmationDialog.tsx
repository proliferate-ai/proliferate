import { ConfirmationDialog } from "@proliferate/ui";

const noop = () => {};

export const DestructiveConfirm = () => (
  <ConfirmationDialog
    open
    title="Delete workspace “proliferate/proliferate”?"
    description="The sandbox, its worktrees, and every uncommitted change on claude/design-sync-ui-import are removed. This cannot be undone."
    confirmLabel="Delete workspace"
    cancelLabel="Keep workspace"
    confirmVariant="destructive"
    onClose={noop}
    onConfirm={noop}
  />
);

export const PrimaryConfirm = () => (
  <ConfirmationDialog
    open
    title="Push 3 commits to origin/main?"
    description="Proliferate will fast-forward origin/main and open a pull request from claude/design-sync-ui-import."
    confirmLabel="Push and open PR"
    onClose={noop}
    onConfirm={noop}
  />
);

export const LoadingConfirm = () => (
  <ConfirmationDialog
    open
    title="Revoke the GitHub App installation?"
    description="Agents lose read and write access to all 12 connected repositories until the app is reinstalled."
    confirmLabel="Revoking…"
    confirmVariant="destructive"
    loading
    onClose={noop}
    onConfirm={noop}
  />
);

export const CloseDisabled = () => (
  <ConfirmationDialog
    open
    title="Finish migrating your environments"
    description="Cloud environments must be re-pointed at the new runner pool before this session can continue."
    confirmLabel="Migrate now"
    cancelLabel="Not now"
    disableClose
    onClose={noop}
    onConfirm={noop}
  />
);
