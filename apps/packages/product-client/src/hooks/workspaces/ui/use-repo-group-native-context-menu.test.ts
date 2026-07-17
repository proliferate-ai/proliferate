import { describe, expect, it, vi } from "vitest";
import {
  buildRepoGroupMenuModel,
  buildRepoGroupNativeContextMenuItems,
} from "#product/hooks/workspaces/ui/use-repo-group-native-context-menu";

describe("buildRepoGroupMenuModel", () => {
  it("offers Set up Cloud for a Cloud-capable local GitHub repo", () => {
    const model = buildRepoGroupMenuModel({
      environmentKind: "local",
      isGitHubRepo: true,
      canSetUpCloud: true,
      canAddToThisMac: false,
      canOpenCloudSettings: false,
      canOpenRepositorySettings: true,
      canRemoveRepo: true,
    });

    expect(model.map((action) => action.label)).toEqual([
      "Set up Cloud",
      "Repository settings",
      "Remove repository",
    ]);
  });

  it("omits Cloud setup actions for a non-GitHub local repo", () => {
    const model = buildRepoGroupMenuModel({
      environmentKind: "local",
      isGitHubRepo: false,
      canSetUpCloud: true,
      canAddToThisMac: false,
      canOpenCloudSettings: false,
      canOpenRepositorySettings: true,
      canRemoveRepo: true,
    });

    expect(model.map((action) => action.label)).toEqual([
      "Repository settings",
      "Remove repository",
    ]);
  });

  it("offers Add to this Mac and Cloud settings for a cloud-only repo", () => {
    const model = buildRepoGroupMenuModel({
      environmentKind: "cloud",
      isGitHubRepo: true,
      canSetUpCloud: false,
      canAddToThisMac: true,
      canOpenCloudSettings: true,
      canOpenRepositorySettings: true,
      canRemoveRepo: true,
    });

    expect(model.map((action) => action.label)).toEqual([
      "Add to this Mac…",
      "Cloud settings",
      "Repository settings",
      "Remove repository",
    ]);
  });

  it("offers Cloud settings without Add to this Mac for a local_cloud repo", () => {
    const model = buildRepoGroupMenuModel({
      environmentKind: "local_cloud",
      isGitHubRepo: true,
      canSetUpCloud: false,
      canAddToThisMac: true,
      canOpenCloudSettings: true,
      canOpenRepositorySettings: true,
      canRemoveRepo: true,
    });

    expect(model.map((action) => action.label)).toEqual([
      "Cloud settings",
      "Repository settings",
      "Remove repository",
    ]);
  });
});

describe("buildRepoGroupNativeContextMenuItems", () => {
  it("mirrors the DOM model with a separator before the destructive remove", () => {
    const onSetUpCloud = vi.fn();
    const onRemove = vi.fn();
    const model = buildRepoGroupMenuModel({
      environmentKind: "local",
      isGitHubRepo: true,
      canSetUpCloud: true,
      canAddToThisMac: false,
      canOpenCloudSettings: false,
      canOpenRepositorySettings: true,
      canRemoveRepo: true,
    });
    const items = buildRepoGroupNativeContextMenuItems(model, {
      "set-up-cloud": onSetUpCloud,
      "remove-repository": onRemove,
    });

    expect(items).toMatchObject([
      { id: "set-up-cloud", label: "Set up Cloud" },
      { id: "repository-settings", label: "Repository settings" },
      { kind: "separator" },
      { id: "remove-repository", label: "Remove repository" },
    ]);
    if ("id" in items[0]) items[0].onSelect?.();
    if ("id" in items[3]) items[3].onSelect?.();
    expect(onSetUpCloud).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
