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

  it("renders an unsupported-git-state blocker as a disabled, non-dispatching item", () => {
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
          kind: "unsupported-git-state",
          label: "Unsupported Git state",
          blocker: "The workspace has uncommitted changes.",
        },
      ],
      onAvailabilityCommand,
    });

    const blocker = items.find(
      (item) => "id" in item && item.id === "availability-unsupported-git-state",
    );
    expect(blocker).toBeDefined();
    if (blocker && "enabled" in blocker) expect(blocker.enabled).toBe(false);
    if (blocker && "onSelect" in blocker) blocker.onSelect?.();
    expect(onAvailabilityCommand).not.toHaveBeenCalled();
  });
});
