import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceAvailabilityCommands,
  type WorkspaceAvailabilityInput,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";

// The cloud-copies feature died with the cloud workspace stack (cull part 2):
// the host that executed these commands is deleted, so the resolver must not
// offer any of them — a command with no executor is a silent dead-end.
describe("resolveWorkspaceAvailabilityCommands", () => {
  const base: WorkspaceAvailabilityInput = {
    hasLocalWorkspace: true,
    cloudWorkspace: null,
    desktopInstallId: "install-1",
    cloudComputeEnabled: true,
  };

  it.each<[string, WorkspaceAvailabilityInput]>([
    ["local-only workspace (previously: Add Cloud copy)", base],
    [
      "dirty local workspace (previously: Reconcile Git state)",
      { ...base, unsupportedGitBlocker: "This workspace has uncommitted changes." },
    ],
    [
      "stale cloud row with a linked local copy (previously: Unlink this Mac)",
      {
        ...base,
        cloudWorkspace: {
          materializations: [{
            targetKind: "local_desktop",
            desktopInstallId: "install-1",
            state: "hydrated",
          }],
        } as never,
      },
    ],
    [
      "stale cloud-only row (previously: Open on this Mac)",
      { ...base, hasLocalWorkspace: false, cloudWorkspace: { materializations: [] } },
    ],
  ])("offers nothing for a %s", (_name, input) => {
    expect(resolveWorkspaceAvailabilityCommands(input)).toEqual([]);
  });
});
