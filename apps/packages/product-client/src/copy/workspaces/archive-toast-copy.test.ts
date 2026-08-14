import { describe, expect, it } from "vitest";
import {
  archiveNoticeDescription,
  ARCHIVE_TOAST_COPY,
  unarchiveNoticeDescription,
} from "#product/copy/workspaces/archive-toast-copy";

describe("archiveNoticeDescription (T1's conditional description)", () => {
  it("is undefined when no notice is present", () => {
    expect(archiveNoticeDescription([])).toBeUndefined();
  });

  it("surfaces the first known notice's description", () => {
    expect(archiveNoticeDescription(["dirty_submodule"])).toBe(
      ARCHIVE_TOAST_COPY.dirtySubmoduleDescription,
    );
    expect(archiveNoticeDescription(["partial_capture_untracked"])).toBe(
      ARCHIVE_TOAST_COPY.partialCaptureUntrackedDescription,
    );
    expect(archiveNoticeDescription(["aborted_git_operation"])).toBe(
      ARCHIVE_TOAST_COPY.abortedGitOperationDescription,
    );
  });

  it("ignores an unknown future kind (additive-optional) instead of throwing", () => {
    expect(() =>
      archiveNoticeDescription(["some_future_kind" as never])
    ).not.toThrow();
    expect(archiveNoticeDescription(["some_future_kind" as never])).toBeUndefined();
  });

  it("never claims LFS content survives (R2-5)", () => {
    const allDescriptions = Object.values(ARCHIVE_TOAST_COPY).filter(
      (value): value is string => typeof value === "string",
    );
    for (const description of allDescriptions) {
      expect(description.toLowerCase()).not.toContain("lfs");
    }
  });
});

describe("unarchiveNoticeDescription (T2's conditional description)", () => {
  it("is undefined when no notice is present", () => {
    expect(unarchiveNoticeDescription([])).toBeUndefined();
  });

  it("surfaces no_snapshot and history_incomplete descriptions", () => {
    expect(unarchiveNoticeDescription(["no_snapshot"])).toBe(
      ARCHIVE_TOAST_COPY.noSnapshotDescription,
    );
    expect(unarchiveNoticeDescription(["history_incomplete"])).toBe(
      ARCHIVE_TOAST_COPY.historyIncompleteDescription,
    );
  });

  it("does not treat head_mismatch as a T2 description line (it is T11's own trigger)", () => {
    expect(unarchiveNoticeDescription(["head_mismatch"])).toBeUndefined();
  });
});

describe("ARCHIVE_TOAST_COPY title builders", () => {
  it("interpolates the workspace name exactly once per call", () => {
    expect(ARCHIVE_TOAST_COPY.archiveSuccessTitle("my-workspace")).toBe('Archived "my-workspace"');
    expect(ARCHIVE_TOAST_COPY.unarchiveSuccessTitle("my-workspace")).toBe(
      'Unarchived "my-workspace"',
    );
    expect(ARCHIVE_TOAST_COPY.archiveFailedTitle("my-workspace")).toBe(
      'Couldn\'t archive "my-workspace"',
    );
  });

  it("interpolates the git-lock file path into T10's description", () => {
    expect(ARCHIVE_TOAST_COPY.gitLockedDescription("index.lock")).toContain("index.lock");
  });
});
