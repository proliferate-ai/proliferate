import type { ReactNode } from "react";
import { WorkspaceReconciliationBody } from "@proliferate/ui";

/**
 * The props-only comparison body of the workspace-availability dialog: This Mac
 * / Cloud / GitHub branch HEAD side by side, the single safe next action, and
 * what cancelling preserves. It computes nothing — the caller derives every
 * label — so each cell hands it a complete view and the dialog panel it sits in.
 */
function DialogPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-full max-w-3xl rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-popover">
      <h2 className="text-heading text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const IN_SYNC = {
  title: "anyharness · feature/session-activity",
  columns: [
    {
      title: "This Mac",
      branch: "feature/session-activity",
      headShort: "a41c9f2",
      stateLabel: "clean",
      stateTone: "success",
    },
    {
      title: "Cloud",
      branch: "feature/session-activity",
      headShort: "a41c9f2",
      stateLabel: "clean",
      stateTone: "success",
    },
    {
      title: "GitHub branch",
      branch: "feature/session-activity",
      headShort: "a41c9f2",
      stateLabel: "in sync",
      stateTone: "neutral",
      caveat: "Read from the last fetch, 6 minutes ago.",
    },
  ],
  actionDetail:
    "Reopening resumes the cloud sandbox. Nothing is pushed, pulled or rewritten.",
  cancelPreserves:
    "the cloud sandbox stays suspended and your local worktree is untouched.",
};

const DIVERGED = {
  title: "anyharness · fix/session-restore",
  columns: [
    {
      title: "This Mac",
      branch: "fix/session-restore",
      headShort: "7be0d13",
      stateLabel: "2 ahead, dirty",
      stateTone: "destructive",
      caveat: "3 tracked files have uncommitted changes.",
    },
    {
      title: "Cloud",
      branch: "fix/session-restore",
      headShort: "c92a80e",
      stateLabel: "1 ahead",
      stateTone: "info",
    },
    {
      title: "GitHub branch",
      branch: "fix/session-restore",
      headShort: "c92a80e",
      stateLabel: "last-known",
      stateTone: "neutral",
      caveat: "Remote HEAD may be stale — gh is not signed in.",
    },
  ],
  actionDetail:
    "Open the cloud sandbox read-only. Your local commits are not pushed and the cloud branch is not moved.",
  cancelPreserves:
    "both checkouts keep their current commits, and no branch is rewritten.",
};

const MISSING_LOCAL = {
  title: "proliferate-web · release/2026-07",
  columns: [
    {
      title: "This Mac",
      branch: null,
      headShort: null,
      stateLabel: "missing",
      stateTone: "destructive",
      caveat: "The worktree directory no longer exists on disk.",
    },
    {
      title: "Cloud",
      branch: "release/2026-07",
      headShort: "38fa1c7",
      stateLabel: "clean",
      stateTone: "success",
    },
    {
      title: "GitHub branch",
      branch: "release/2026-07",
      headShort: "38fa1c7",
      stateLabel: "in sync",
      stateTone: "neutral",
    },
  ],
  actionDetail:
    "Recreate the local worktree from origin/release/2026-07. Nothing on the cloud sandbox changes.",
  cancelPreserves: "the cloud sandbox and the remote branch exactly as they are.",
};

export const InSync = () => (
  <DialogPanel title="Reopen this workspace?">
    <WorkspaceReconciliationBody view={IN_SYNC} />
  </DialogPanel>
);

export const Diverged = () => (
  <DialogPanel title="These checkouts have diverged">
    <WorkspaceReconciliationBody view={DIVERGED} />
  </DialogPanel>
);

export const MissingLocalWorktree = () => (
  <DialogPanel title="The local worktree is missing">
    <WorkspaceReconciliationBody view={MISSING_LOCAL} />
  </DialogPanel>
);
