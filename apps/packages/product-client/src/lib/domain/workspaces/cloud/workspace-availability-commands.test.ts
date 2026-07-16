import { describe, expect, it } from "vitest";
import {
  deriveWorkspaceAvailabilityInput,
  resolveWorkspaceAvailabilityCommands,
  unsupportedGitBlockerForLocalWorkspace,
  type WorkspaceAvailabilityInput,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

const CLEAN_PUBLISHED: WorkspaceGitStatus = {
  branch: "feat/x",
  dirty: false,
  conflicted: false,
  ahead: 0,
  behind: 0,
  hasUpstream: true,
  pr: null,
  attention: "none",
  capturedAt: "2026-07-16T00:00:00Z",
  source: "live",
};

const HYDRATED_LOCAL = {
  id: "m-local",
  targetKind: "local_desktop" as const,
  desktopInstallId: "mac-a",
  anyharnessWorkspaceId: "ws-1",
  worktreePath: "/a",
  state: "hydrated" as const,
  generation: 1,
  expectedHeadSha: null,
  observedHeadSha: null,
  observedBranch: null,
  failureCode: null,
  lastReportedAt: null,
};

function kinds(input: WorkspaceAvailabilityInput): string[] {
  return resolveWorkspaceAvailabilityCommands(input).map((c) => c.kind);
}

describe("resolveWorkspaceAvailabilityCommands", () => {
  it("offers Link copies from the separate ledger-backed Cloud slot", () => {
    expect(resolveWorkspaceAvailabilityCommands({
      hasLocalWorkspace: false,
      cloudWorkspace: { materializations: [{
        id: "managed",
        targetKind: "managed_cloud",
      }] as never },
      desktopInstallId: "install-1",
      linkCandidate: true,
      localMaterializationNeedsRepair: false,
      unsupportedGitBlocker: null,
    }).map((command) => command.kind)).toEqual(["link-copies"]);
  });
  it("offers Add Cloud copy for a local-only workspace", () => {
    expect(
      kinds({ hasLocalWorkspace: true, cloudWorkspace: null, desktopInstallId: "mac-a" }),
    ).toEqual(["add-cloud-copy"]);
  });

  it("offers Open on this Mac for a Cloud-only workspace", () => {
    expect(
      kinds({
        hasLocalWorkspace: false,
        cloudWorkspace: { materializations: [] },
        desktopInstallId: "mac-a",
      }),
    ).toEqual(["open-on-this-mac"]);
  });

  it("offers Link copies for a heuristic local + Cloud exact-ref match", () => {
    expect(
      kinds({
        hasLocalWorkspace: true,
        cloudWorkspace: { materializations: [] },
        desktopInstallId: "mac-a",
        linkCandidate: true,
      }),
    ).toEqual(["link-copies"]);
  });

  it("offers only Unlink for a healthy explicit link", () => {
    expect(
      kinds({
        hasLocalWorkspace: true,
        cloudWorkspace: { materializations: [HYDRATED_LOCAL] },
        desktopInstallId: "mac-a",
      }),
    ).toEqual(["unlink-this-mac"]);
  });

  it("offers relink/recreate/unlink when the linked local copy is missing", () => {
    expect(
      kinds({
        hasLocalWorkspace: false,
        cloudWorkspace: {
          materializations: [{ ...HYDRATED_LOCAL, state: "missing" }],
        },
        desktopInstallId: "mac-a",
        localMaterializationNeedsRepair: true,
      }),
    ).toEqual(["relink-existing", "recreate-on-this-mac", "unlink-this-mac"]);
  });

  it("shows a selectable blocker for an unsupported Git state", () => {
    const commands = resolveWorkspaceAvailabilityCommands({
      hasLocalWorkspace: true,
      cloudWorkspace: null,
      desktopInstallId: "mac-a",
      unsupportedGitBlocker: "The workspace has uncommitted changes.",
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]!.kind).toBe("unsupported-git-state");
    expect(commands[0]!.blocker).toBe("The workspace has uncommitted changes.");
  });

  it("does not un-redact another install's link (no explicit link matched)", () => {
    // A local_desktop row for a different install must not count as this
    // install's link; a local-only workspace still offers Add Cloud copy.
    expect(
      kinds({
        hasLocalWorkspace: true,
        cloudWorkspace: null,
        desktopInstallId: "mac-a",
      }),
    ).toEqual(["add-cloud-copy"]);
  });
});

describe("unsupportedGitBlockerForLocalWorkspace", () => {
  it("accepts a clean, published, in-sync normal branch", () => {
    expect(unsupportedGitBlockerForLocalWorkspace(CLEAN_PUBLISHED)).toBeNull();
  });

  it("blocks dirty / conflicted / unpublished / out-of-sync / unknown states", () => {
    expect(unsupportedGitBlockerForLocalWorkspace({ ...CLEAN_PUBLISHED, dirty: true })).toMatch(/uncommitted/);
    expect(unsupportedGitBlockerForLocalWorkspace({ ...CLEAN_PUBLISHED, conflicted: true })).toMatch(/conflict/);
    expect(unsupportedGitBlockerForLocalWorkspace({ ...CLEAN_PUBLISHED, hasUpstream: false })).toMatch(/published/);
    expect(unsupportedGitBlockerForLocalWorkspace({ ...CLEAN_PUBLISHED, ahead: 1 })).toMatch(/in sync/);
    expect(unsupportedGitBlockerForLocalWorkspace({ ...CLEAN_PUBLISHED, dirty: null })).toMatch(/not available/);
    expect(unsupportedGitBlockerForLocalWorkspace(null)).toMatch(/not available/);
  });
});

describe("deriveWorkspaceAvailabilityInput", () => {
  it("blocks Add Cloud copy on a dirty local source", () => {
    const input = deriveWorkspaceAvailabilityInput({
      localWorkspace: { id: "ws-1" },
      cloudWorkspace: null,
      desktopInstallId: "mac-a",
      localGitStatus: { ...CLEAN_PUBLISHED, dirty: true },
    });
    expect(resolveWorkspaceAvailabilityCommands(input).map((c) => c.kind)).toEqual([
      "unsupported-git-state",
    ]);
  });

  it("offers Add Cloud copy on a clean published local source", () => {
    const input = deriveWorkspaceAvailabilityInput({
      localWorkspace: { id: "ws-1" },
      cloudWorkspace: null,
      desktopInstallId: "mac-a",
      localGitStatus: CLEAN_PUBLISHED,
    });
    expect(resolveWorkspaceAvailabilityCommands(input).map((c) => c.kind)).toEqual([
      "add-cloud-copy",
    ]);
  });

  it("never blocks a Cloud-only Open on this Mac on local git status", () => {
    const input = deriveWorkspaceAvailabilityInput({
      localWorkspace: null,
      cloudWorkspace: { materializations: [] },
      desktopInstallId: "mac-a",
      localGitStatus: null,
    });
    expect(resolveWorkspaceAvailabilityCommands(input).map((c) => c.kind)).toEqual([
      "open-on-this-mac",
    ]);
  });

  it("derives relink/recreate/unlink for a missing explicit link regardless of git status", () => {
    const input = deriveWorkspaceAvailabilityInput({
      localWorkspace: null,
      cloudWorkspace: {
        materializations: [{
          id: "m",
          targetKind: "local_desktop",
          desktopInstallId: "mac-a",
          anyharnessWorkspaceId: "ws-1",
          worktreePath: "/a",
          state: "missing",
          generation: 3,
          expectedHeadSha: null,
          observedHeadSha: null,
          observedBranch: null,
          failureCode: null,
          lastReportedAt: null,
        }],
      },
      desktopInstallId: "mac-a",
      localGitStatus: null,
    });
    expect(resolveWorkspaceAvailabilityCommands(input).map((c) => c.kind)).toEqual([
      "relink-existing",
      "recreate-on-this-mac",
      "unlink-this-mac",
    ]);
  });
});
