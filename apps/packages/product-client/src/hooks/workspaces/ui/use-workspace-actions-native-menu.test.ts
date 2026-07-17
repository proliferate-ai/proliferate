import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceActionsNativeMenuItems } from "#product/hooks/workspaces/ui/use-workspace-actions-native-menu";

describe("buildWorkspaceActionsNativeMenuItems", () => {
  it("keeps the header overflow menu chat-only", () => {
    const onRename = vi.fn();
    const items = buildWorkspaceActionsNativeMenuItems({
      canRename: true,
      canFork: false,
      canDismiss: true,
      onRename,
      onFork: vi.fn(),
      onDismiss: vi.fn(),
    });

    expect(items).toMatchObject([
      { id: "rename-chat", label: "Rename chat", enabled: true },
      { id: "fork-chat", label: "Fork chat", enabled: false },
      { kind: "separator" },
      { id: "archive-chat", label: "Archive chat", enabled: true },
    ]);
    const rename = items[0];
    if (rename && "onSelect" in rename) rename.onSelect?.();
    expect(onRename).toHaveBeenCalledOnce();
    expect(items.some((item) => "id" in item && /commit|push|pull-request/.test(item.id))).toBe(false);
  });

  it("appends workspace-copy availability commands and dispatches by kind", () => {
    const onAvailabilityCommand = vi.fn();
    const items = buildWorkspaceActionsNativeMenuItems({
      canRename: true,
      canFork: false,
      canDismiss: true,
      onRename: vi.fn(),
      onFork: vi.fn(),
      onDismiss: vi.fn(),
      availabilityCommands: [
        { kind: "add-cloud-copy", label: "Add Cloud copy…" },
      ],
      onAvailabilityCommand,
    });

    const availability = items.find(
      (item) => "id" in item && item.id === "availability-add-cloud-copy",
    );
    expect(availability).toBeDefined();
    if (availability && "onSelect" in availability) availability.onSelect?.();
    expect(onAvailabilityCommand).toHaveBeenCalledWith("add-cloud-copy");
  });

  it("renders reconcile-git-state as an actionable, dispatching item (PR 6)", () => {
    const onAvailabilityCommand = vi.fn();
    const items = buildWorkspaceActionsNativeMenuItems({
      canRename: false,
      canFork: false,
      canDismiss: false,
      onRename: vi.fn(),
      onFork: vi.fn(),
      onDismiss: vi.fn(),
      availabilityCommands: [
        {
          kind: "reconcile-git-state",
          label: "Reconcile Git state…",
          blocker: "The workspace has uncommitted changes.",
        },
      ],
      onAvailabilityCommand,
    });

    const item = items.find(
      (entry) => "id" in entry && entry.id === "availability-reconcile-git-state",
    );
    expect(item).toBeDefined();
    if (item && "enabled" in item) expect(item.enabled).toBe(true);
    if (item && "onSelect" in item) item.onSelect?.();
    expect(onAvailabilityCommand).toHaveBeenCalledWith("reconcile-git-state");
  });
});
