import type { WorkspaceArchiveNoticeKind, WorkspaceUnarchiveNoticeKind } from "@anyharness/sdk";

/**
 * The archive/unarchive toast set (T1-T2, T4-T11 — T3 was retired by the
 * stable-path ruling: unarchive never relocates). Every literal lives here,
 * per the `copy/**` ownership rule, and every builder returns a plain string
 * so no exception text can ever reach a headline: `scripts/check_toast_copy.py`
 * bans a built `headline:` value, not a built announcement `title` — this
 * module is where the one legal kind of interpolation (a workspace name into
 * a title) happens, and it happens exactly once per call.
 */
export const ARCHIVE_TOAST_COPY = {
  archiveSuccessTitle: (name: string) => `Archived "${name}"`,
  unarchiveSuccessTitle: (name: string) => `Unarchived "${name}"`,
  archiveFailedTitle: (name: string) => `Couldn't archive "${name}"`,
  unarchiveFailedTitle: (name: string) => `Couldn't restore "${name}"`,
  busyTitle: (name: string) => `"${name}" is busy`,
  headMismatchTitle: (name: string) => `Restored "${name}", with a mismatch`,

  undoLabel: "Undo",
  viewArchivedLabel: "View archived",
  viewNowLabel: "View now",

  gitOperationInProgressDescription: "Finish or abort the git operation in progress first.",
  archiveFailedDescription:
    "Couldn't save the snapshot. Your files are untouched, but running sessions were stopped. Try again.",
  unbornHeadDescription:
    "Make a first commit before archiving — there's no commit to anchor the snapshot to.",
  busyDescription: "Another operation is still running. Try again in a moment.",
  unarchiveFailedDescription:
    "Something went wrong while restoring. Your archived snapshot is intact — try again.",
  hollowCheckoutDescription:
    "This workspace's folder isn't its own git checkout, so a snapshot would capture the wrong repository.",
  gitLockedDescription: (file: string) =>
    `A git lock file is blocking the snapshot (${file}). If no git command is running, remove it and try again.`,
  headMismatchDescription:
    "The restored workspace doesn't match the archived snapshot. Your snapshot is fully preserved — unarchive again to resolve.",

  dirtySubmoduleDescription:
    "Some submodules were left untouched — they weren't captured in the snapshot.",
  embeddedRepoDescription:
    "An embedded repository was left untouched — it wasn't captured in the snapshot.",
  partialCaptureUntrackedDescription:
    "Some untracked files couldn't be captured and were left out of the snapshot.",
  partialCaptureTrackedDescription:
    "Some tracked changes couldn't be captured and were left out of the snapshot.",
  abortedGitOperationDescription:
    "An in-progress git operation was aborted so the snapshot could be taken safely.",
  noSnapshotDescription: "No prior snapshot was found — the workspace was restored as-is.",
  historyIncompleteDescription:
    "Some history couldn't be restored. The workspace is usable, but a few commits may be missing.",
} as const;

/** T1's conditional description: the first archive notice worth surfacing, or none. */
export function archiveNoticeDescription(
  noticeKinds: readonly WorkspaceArchiveNoticeKind[],
): string | undefined {
  for (const kind of noticeKinds) {
    switch (kind) {
      case "dirty_submodule":
        return ARCHIVE_TOAST_COPY.dirtySubmoduleDescription;
      case "embedded_repo":
        return ARCHIVE_TOAST_COPY.embeddedRepoDescription;
      case "partial_capture_untracked":
        return ARCHIVE_TOAST_COPY.partialCaptureUntrackedDescription;
      case "partial_capture_tracked":
        return ARCHIVE_TOAST_COPY.partialCaptureTrackedDescription;
      case "aborted_git_operation":
        return ARCHIVE_TOAST_COPY.abortedGitOperationDescription;
      default:
        // Additive-optional: an unknown future kind is ignored, not rendered.
        continue;
    }
  }
  return undefined;
}

/** T2's conditional description: the first unarchive notice worth surfacing, or none. */
export function unarchiveNoticeDescription(
  noticeKinds: readonly WorkspaceUnarchiveNoticeKind[],
): string | undefined {
  for (const kind of noticeKinds) {
    switch (kind) {
      case "no_snapshot":
        return ARCHIVE_TOAST_COPY.noSnapshotDescription;
      case "history_incomplete":
        return ARCHIVE_TOAST_COPY.historyIncompleteDescription;
      case "partial_capture_untracked":
        return ARCHIVE_TOAST_COPY.partialCaptureUntrackedDescription;
      case "partial_capture_tracked":
        return ARCHIVE_TOAST_COPY.partialCaptureTrackedDescription;
      // head_mismatch is T11's own trigger, not a T2 description line.
      case "head_mismatch":
      default:
        continue;
    }
  }
  return undefined;
}
