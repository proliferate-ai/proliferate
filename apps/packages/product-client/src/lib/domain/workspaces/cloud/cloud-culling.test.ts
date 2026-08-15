import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  cullCloudWorkspaceRows,
  isCulledCloudOnlyRepository,
} from "#product/lib/domain/workspaces/cloud/cloud-culling";
import { buildWorkspaceCollections } from "#product/lib/domain/workspaces/cloud/collections";
import { buildSettingsRepositoryEntries } from "#product/lib/domain/settings/repositories";
import {
  buildAutomationInventoryItems,
  groupAutomationInventoryItems,
  type AutomationInventoryRecord,
} from "#product/domain/automations/inventory";

function cloudWorkspace(id: string): CloudWorkspaceSummary {
  return { id, repo: { provider: "github", owner: "acme", name: "app" } } as unknown as CloudWorkspaceSummary;
}

function localWorkspace(id: string): Workspace {
  return {
    id,
    path: `/repos/${id}`,
    updatedAt: "2026-08-15T00:00:00.000Z",
    lifecycleState: "active",
    kind: "local",
  } as unknown as Workspace;
}

function repoRoot(id: string, owner: string, name: string): RepoRoot {
  return {
    id,
    path: `/repos/${name}`,
    remoteProvider: "github",
    remoteOwner: owner,
    remoteRepoName: name,
  } as unknown as RepoRoot;
}

function cloudRepoConfig(owner: string, name: string): RepoConfigResponse {
  return {
    gitProvider: "github",
    gitOwner: owner,
    gitRepoName: name,
    environments: [{ kind: "cloud", defaultBranch: "main" }],
  } as unknown as RepoConfigResponse;
}

describe("cloud culling data-source filter (FM1)", () => {
  it("removes every cloud workspace row — cloud rows in, zero cloud rows out", () => {
    const result = cullCloudWorkspaceRows([
      cloudWorkspace("cw-1"),
      cloudWorkspace("cw-2"),
    ]);
    expect(result).toEqual([]);
  });

  it("drops cloud workspaces at the single collections seam while keeping local rows", () => {
    const collections = buildWorkspaceCollections(
      [localWorkspace("lw-1"), localWorkspace("lw-2")],
      [],
      [cloudWorkspace("cw-1"), cloudWorkspace("cw-2")],
    );

    expect(collections.cloudWorkspaces).toEqual([]);
    expect(collections.localWorkspaces.map((w) => w.id).sort()).toEqual(["lw-1", "lw-2"]);
    expect(collections.workspaces).toHaveLength(2);
  });
});

describe("cloud-only repository culling (FR-2)", () => {
  it("flags cloud-only availability as culled, keeps local and local_cloud", () => {
    expect(isCulledCloudOnlyRepository("cloud")).toBe(true);
    expect(isCulledCloudOnlyRepository("local")).toBe(false);
    expect(isCulledCloudOnlyRepository("local_cloud")).toBe(false);
  });

  it("hides cloud-only repos from the settings repository list entirely", () => {
    const entries = buildSettingsRepositoryEntries(
      [localWorkspace("lw-1")],
      [repoRoot("rr-1", "acme", "local-app")],
      [cloudRepoConfig("acme", "cloud-only-app")],
    );

    expect(entries.some((entry) => entry.availability === "cloud")).toBe(false);
    // The local repo stays; the cloud-only repo never appears.
    expect(entries.map((entry) => entry.name)).toEqual(["local-app"]);
  });

  it("keeps a local repo that is also cloud-configured (local_cloud stays)", () => {
    const entries = buildSettingsRepositoryEntries(
      [localWorkspace("lw-1")],
      [repoRoot("rr-1", "acme", "app")],
      [cloudRepoConfig("acme", "app")],
    );

    const app = entries.find((entry) => entry.name === "app");
    expect(app?.availability).toBe("local_cloud");
  });
});

describe("cloud-target automation carve-out (FM5)", () => {
  function automation(
    id: string,
    targetMode: AutomationInventoryRecord["targetMode"],
  ): AutomationInventoryRecord {
    return {
      id,
      gitOwner: "acme",
      gitRepoName: "app",
      title: `Automation ${id}`,
      schedule: { summary: "Daily", nextRunAt: "2026-08-16T00:00:00.000Z" },
      targetMode,
      enabled: true,
    };
  }

  it("keeps cloud-target automations listed and badges them inactive", () => {
    const items = buildAutomationInventoryItems([
      automation("personal", "personal_cloud"),
      automation("shared", "shared_cloud"),
      automation("local", "local"),
    ]);

    // Carve-out: cloud-target rows are NOT filtered out.
    expect(items.map((item) => item.id).sort()).toEqual(["local", "personal", "shared"]);

    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get("personal")?.targetInactiveBadge).toBe("Target no longer available");
    expect(byId.get("shared")?.targetInactiveBadge).toBe("Target no longer available");
    // Local targets stay active — no inactive badge.
    expect(byId.get("local")?.targetInactiveBadge).toBeNull();

    // Grouping never drops the cloud rows either.
    const grouped = groupAutomationInventoryItems(items);
    const groupedIds = grouped.flatMap((group) => group.items.map((item) => item.id));
    expect(groupedIds.sort()).toEqual(["local", "personal", "shared"]);
  });
});
