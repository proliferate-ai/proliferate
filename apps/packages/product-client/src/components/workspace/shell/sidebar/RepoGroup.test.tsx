// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoGroup } from "#product/components/workspace/shell/sidebar/RepoGroup";
import type { NewWorkspaceCommandScope } from "#product/lib/domain/workspaces/creation/new-workspace-command";
import { useNewWorkspaceCommandScopeStore } from "#product/stores/workspaces/new-workspace-command-scope-store";

vi.mock("#product/primitives/icons/core", () => ({
  Settings: () => <span data-icon="settings" />,
  Trash: () => <span data-icon="trash" />,
}));

vi.mock("#product/primitives/icons/app-shell", () => ({
  AppShellNewChatIcon: () => <span data-icon="new-chat" />,
}));

vi.mock("#product/primitives/icons/platform", () => ({
  CloudIcon: () => <span data-icon="cloud" />,
}));

vi.mock("#product/primitives/icons/workspace", () => ({
  FolderClosed: () => <span data-icon="folder-closed" />,
  FolderFilled: () => <span data-icon="folder-filled" />,
  FolderRemote: () => <span data-icon="folder-remote" />,
}));

vi.mock("#product/primitives/PopoverButton", () => ({
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
    const testId = className?.includes("w-52") ? "context-popover" : "popover";
    return (
      <div data-testid={testId}>
        {trigger}
        {testId === "context-popover" ? (
          <button type="button" onClick={() => onOpenChange?.(true)}>
            Open context menu
          </button>
        ) : null}
        <div>{children(() => onOpenChange?.(false))}</div>
      </div>
    );
  },
}));

vi.mock("#product/primitives/PopoverMenuItem", () => ({
  PopoverMenuItem: ({ disabled, label, onClick, trailing }: {
    disabled?: boolean;
    label: string;
    onClick?: () => void;
    trailing?: ReactNode;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{label}{trailing}</button>
  ),
}));

vi.mock("#product/primitives/patterns/ConfirmationDialog", () => ({
  ConfirmationDialog: ({
    description,
    loading,
    onConfirm,
    open,
  }: {
    description: string;
    loading?: boolean;
    onConfirm: () => void;
    open: boolean;
  }) => open ? (
    <div role="dialog">
      <span>{description}</span>
      <button type="button" disabled={loading} onClick={onConfirm}>
        {loading ? "Removing repository" : "Confirm removal"}
      </button>
    </div>
  ) : null,
}));

vi.mock("#product/primitives/ShortcutBadge", () => ({
  ShortcutBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock("#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon", () => ({
  SidebarWorkspaceVariantIcon: () => <span data-icon="variant" />,
}));

vi.mock("#product/hooks/workspaces/ui/use-repo-group-native-context-menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#product/hooks/workspaces/ui/use-repo-group-native-context-menu")>()),
  useRepoGroupNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

vi.mock("#product/primitives/patterns/SidebarActionButton", () => ({
  SidebarActionButton: ({
    children,
    onClick,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    title: string;
  }) => (
    <button type="button" aria-label={title} onClick={onClick}>{children}</button>
  ),
}));

vi.mock("#product/components/workspace/shell/sidebar/ProductSidebarRepositories", () => ({
  ProductSidebarRepoGroupHeader: ({ action, collapsed, expandedIcon, hoverIcon, icon, label }: {
    action: ReactNode;
    collapsed: boolean;
    expandedIcon: ReactNode;
    hoverIcon: ReactNode;
    icon: ReactNode;
    label: string;
  }) => (
    <div>
      <span data-testid="repository-icon">{collapsed ? icon : (expandedIcon ?? icon)}</span>
      <span data-testid="repository-hover-icon">{hoverIcon}</span>
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

describe("RepoGroup", () => {

  afterEach(() => {
    cleanup();
    useNewWorkspaceCommandScopeStore.setState({ activeScope: null });
  });

  it("uses one hover action to start a repo-scoped new chat", () => {
    const onNewChat = vi.fn();
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onNewChat={onNewChat}
        onNewLocalWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New chat in Repo A" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Repository options" })).toBeNull();
  });

  it("scopes displayed creation shortcuts to the context-menu repository", () => {
    const { unmount } = render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onNewLocalWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
        newWorkspaceCommandScope={scope}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open context menu" }));
    expect(useNewWorkspaceCommandScopeStore.getState().activeScope?.id).toBe(scope.id);

    unmount();
    expect(useNewWorkspaceCommandScopeStore.getState().activeScope).toBeNull();
  });

  it("marks remote-capable repository groups with the fused folder+globe glyph", () => {
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        environmentKind="local_cloud"
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(document.querySelector('[data-icon="folder-remote"]')).toBeTruthy();
  });

  it("keeps the current local folder glyph unchanged on hover", () => {
    const { rerender } = render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(screen.getByTestId("repository-icon").querySelector('[data-icon="folder-filled"]')).toBeTruthy();
    expect(screen.getByTestId("repository-hover-icon").querySelector('[data-icon="folder-filled"]')).toBeTruthy();

    rerender(
      <RepoGroup
        name="Repo A"
        collapsed
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(screen.getByTestId("repository-icon").querySelector('[data-icon="folder-closed"]')).toBeTruthy();
    expect(screen.getByTestId("repository-hover-icon").querySelector('[data-icon="folder-closed"]')).toBeTruthy();
  });

  it("moves creation and repository management into the shared context menu", () => {
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        environmentKind="local"
        isGitHubRepo
        canSetUpCloud
        onSetUpCloud={vi.fn()}
        onNewLocalWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
        onRemoveRepo={vi.fn()}
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(screen.getByRole("button", { name: /New local workspace/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /New worktree/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up Cloud" })).toBeTruthy();
  });

  it("offers only the cloud creation action where local workspaces are unsupported", () => {
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        environmentKind="local_cloud"
        localWorkspacesSupported={false}
        cloudWorkspaceLabel="New workspace"
        onCloudWorkspaceAction={vi.fn()}
        onToggleCollapsed={vi.fn()}
      >
        <div>Workspace A</div>
      </RepoGroup>,
    );

    expect(screen.queryByRole("button", { name: "New local workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New worktree" })).toBeNull();
    expect(screen.getByRole("button", { name: /New workspace/ })).toBeTruthy();
  });

  it("keeps removal pending until the Cloud mutation settles", async () => {
    let resolveRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      resolveRemoval = resolve;
    });
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        environmentKind="cloud"
        onToggleCollapsed={vi.fn()}
        onRemoveRepo={() => removal}
      >
        <div />
      </RepoGroup>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove repository" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(
      screen.getByRole("button", { name: "Removing repository" }).hasAttribute("disabled"),
    ).toBe(true);

    resolveRemoval();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps removal failure visible for retry", async () => {
    render(
      <RepoGroup
        name="Repo A"
        collapsed={false}
        environmentKind="cloud"
        onToggleCollapsed={vi.fn()}
        onRemoveRepo={() => Promise.reject(new Error("Repository is still in use."))}
      >
        <div />
      </RepoGroup>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove repository" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByText(/Repository is still in use\./)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
