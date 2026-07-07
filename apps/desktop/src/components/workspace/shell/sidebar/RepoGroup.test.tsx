// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepoGroup } from "@/components/workspace/shell/sidebar/RepoGroup";
import type { NewWorkspaceCommandScope } from "@/lib/domain/workspaces/creation/new-workspace-command";
import { useNewWorkspaceCommandScopeStore } from "@/stores/workspaces/new-workspace-command-scope-store";

vi.mock("@proliferate/ui/icons", () => ({
  ChevronRight: () => <span data-icon="chevron" />,
  CloudIcon: () => <span data-icon="cloud" />,
  FolderClosedFilled: () => <span data-icon="folder-closed" />,
  FolderFilled: () => <span data-icon="folder-filled" />,
  Globe: () => <span data-icon="globe" />,
  Plus: () => <span data-icon="plus" />,
  Settings: () => <span data-icon="settings" />,
  Trash: () => <span data-icon="trash" />,
}));

vi.mock("@proliferate/ui/primitives/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  POPOVER_SURFACE_CLASS: "popover-surface",
  PopoverButton: ({
    children,
    className,
    onOpenChange,
    trigger,
  }: {
    children: (close: () => void) => ReactNode;
    className?: string;
    onOpenChange?: (open: boolean) => void;
    trigger: ReactNode;
  }) => {
    const testId = className?.includes("w-64") ? "create-popover" : "context-popover";
    return (
      <div data-testid={testId}>
        {trigger}
        <button type="button" onClick={() => onOpenChange?.(true)}>
          Open {testId}
        </button>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Close {testId}
        </button>
        <div>{children(() => onOpenChange?.(false))}</div>
      </div>
    );
  },
}));

vi.mock("@proliferate/ui/primitives/PopoverMenuItem", () => ({
  PopoverMenuItem: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));

vi.mock("@proliferate/ui/primitives/ConfirmationDialog", () => ({
  ConfirmationDialog: () => null,
}));

vi.mock("@proliferate/ui/layout/ShortcutBadge", () => ({
  ShortcutBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock("@/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon", () => ({
  SidebarWorkspaceVariantIcon: () => <span data-icon="variant" />,
}));

vi.mock("@/hooks/workspaces/ui/use-repo-group-native-context-menu", () => ({
  useRepoGroupNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

vi.mock("@proliferate/ui/layout/SidebarActionButton", () => ({
  SidebarActionButton: ({
    children,
    title,
  }: {
    children: ReactNode;
    title: string;
  }) => (
    <button type="button" aria-label={title}>{children}</button>
  ),
}));

vi.mock("@proliferate/product-ui/sidebar/ProductSidebarRepositories", () => ({
  ProductSidebarRepoGroupHeader: ({ action, collapsed, expandedIcon, icon, label }: {
    action: ReactNode;
    collapsed: boolean;
    expandedIcon: ReactNode;
    icon: ReactNode;
    label: string;
  }) => (
    <div>
      {collapsed ? icon : expandedIcon}
      <span>{label}</span>
      {action}
    </div>
  ),
}));

const scope: NewWorkspaceCommandScope = {
  id: "sidebar:/repo-a",
  source: "sidebar",
  repoGroupKeyToExpand: "/repo-a",
  localSourceRoot: "/repo-a",
  repoRootId: "repo-root-a",
  sourceWorkspaceId: null,
  cloudRepoTarget: null,
  baseBranch: null,
  defaultBranch: null,
};

describe("RepoGroup new workspace command scope", () => {

  beforeEach(() => {
    useNewWorkspaceCommandScopeStore.setState({ activeScope: null });
  });

  afterEach(() => {
    cleanup();
    useNewWorkspaceCommandScopeStore.setState({ activeScope: null });
  });

  it("clears an active create-menu scope when the repo group unmounts", () => {
    const { unmount } = render(
      <RepoGroup
        name="Repo A"
        count={1}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        newWorkspaceCommandScope={scope}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open create-popover" }));
    expect(useNewWorkspaceCommandScopeStore.getState().activeScope?.id).toBe(scope.id);

    unmount();

    expect(useNewWorkspaceCommandScopeStore.getState().activeScope).toBeNull();
  });

  it("marks local cloud repository groups with a cloud overlay", () => {
    render(
      <RepoGroup
        name="Repo A"
        count={1}
        collapsed={false}
        environmentKind="local_cloud"
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(document.querySelector('[data-icon="globe"]')).toBeTruthy();
  });
});
