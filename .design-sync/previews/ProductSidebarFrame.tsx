import type { ReactNode } from "react";
import {
  AppShellNewChatIcon,
  Blocks,
  CloudIcon,
  FolderFilled,
  FolderRemote,
  GitPullRequest,
  Grid,
  LifeBuoy,
  Plus,
  ProductSidebarBody,
  ProductSidebarBrandRow,
  ProductSidebarFrame,
  ProductSidebarPrimaryNavigation,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarShowToggleRow,
  ProductSidebarThreadRow,
  ProductSidebarWorkspaceRow,
  ProliferateIcon,
  ShortcutBadge,
  SidebarActionButton,
  SidebarRowSurface,
  Spinner,
  UserAvatar,
} from "@proliferate/ui";

const noop = () => {};

/**
 * `ProductSidebarFrame` is `flex h-full flex-col` — it needs a bounded parent
 * or the whole column collapses. The box below stands in for the app window's
 * sidebar rail (the product renders it at ~288px, i.e. `w-72`).
 */
function SidebarBox({ children, height = 640 }: { children: ReactNode; height?: number }) {
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-border" style={{ height }}>
      {children}
    </div>
  );
}

const NAV_ITEMS = [
  {
    id: "new-chat",
    label: "New chat",
    icon: <AppShellNewChatIcon className="icon-paired" />,
    active: true,
    shortcutLabel: "⌘N",
  },
  {
    id: "workspaces",
    label: "Workspaces",
    icon: <Grid className="icon-paired" />,
    active: false,
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: <Blocks className="icon-paired" />,
    active: false,
    status: (
      <span className="font-mono text-ui-sm uppercase tracking-wide text-sidebar-muted-foreground">
        beta
      </span>
    ),
  },
  {
    id: "support",
    label: "Support",
    icon: <LifeBuoy className="icon-paired" />,
    active: false,
    shortcutLabel: "⌘/",
  },
];

function AccountFooter() {
  return (
    <div className="shrink-0 px-2 pb-2">
      <SidebarRowSurface onPress={noop} className="h-10 gap-2 px-2 text-sidebar-row">
        <UserAvatar displayName="Pablo Sánchez" className="size-6" />
        <span className="min-w-0 flex-1 truncate">Pablo Sánchez</span>
        <ShortcutBadge label="⌘," className="text-sidebar-muted-foreground" />
      </SidebarRowSurface>
    </div>
  );
}

/** The whole product sidebar: brand, primary nav, repositories, chats, account. */
export const FullSidebar = () => (
  <SidebarBox>
    <ProductSidebarFrame footer={<AccountFooter />}>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
        <ProductSidebarScrollableContent>
          <ProductSidebarSectionHeader
            label="Repositories"
            collapsed={false}
            onToggleCollapsed={noop}
          />

          <ProductSidebarRepoGroupHeader
            label="proliferate"
            collapsed={false}
            icon={<FolderFilled className="icon-paired shrink-0" />}
            expandedIcon={<FolderFilled className="icon-paired shrink-0" />}
            onToggleCollapsed={noop}
          />
          <ProductSidebarWorkspaceRow
            label="design-sync-ui-import"
            active
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "open", number: 812 }}
            trailingLabel="2m"
            onSelect={noop}
          />
          <ProductSidebarWorkspaceRow
            label="sidebar-retune-round-4"
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "checks_failing", number: 806 }}
            trailingStatus={<Spinner className="size-4 text-sidebar-muted-foreground" />}
            onSelect={noop}
          />
          <ProductSidebarShowToggleRow label="Show more" onClick={noop} />

          <ProductSidebarRepoGroupHeader
            label="cloud-control"
            collapsed={false}
            icon={<FolderRemote className="icon-paired shrink-0" />}
            onToggleCollapsed={noop}
          />
          <ProductSidebarWorkspaceRow
            label="billing-enforce-mode"
            leadingGlyph={<CloudIcon className="icon-paired" />}
            unreadDot
            onSelect={noop}
          />
          <ProductSidebarWorkspaceRow
            label="fix-provisioning-race"
            leadingGlyph={<CloudIcon className="icon-paired" />}
            trailingLabel="Tue"
            onSelect={noop}
          />

          <ProductSidebarRepoGroupHeader
            label="anyharness"
            collapsed
            icon={<FolderFilled className="icon-paired shrink-0" />}
            onToggleCollapsed={noop}
          />

          <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
          <ProductSidebarThreadRow
            label="Port the sidebar retune to web"
            trailingLabel="9m"
            onSelect={noop}
          />
          <ProductSidebarThreadRow
            label="Flaky worktree cleanup on quit"
            trailingLabel="Mon"
            onSelect={noop}
          />
          <ProductSidebarThreadRow
            label="Draft release notes for 0.14"
            trailingLabel="Mon"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** Frame with only the brand row, nav and an empty repositories section. */
export const NoRepositoriesYet = () => (
  <SidebarBox height={420}>
    <ProductSidebarFrame footer={<AccountFooter />}>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
        <ProductSidebarScrollableContent>
          <ProductSidebarSectionHeader
            label="Repositories"
            collapsed={false}
            onToggleCollapsed={noop}
            actions={(
              <SidebarActionButton title="Add repository" alwaysVisible variant="section">
                <Plus />
              </SidebarActionButton>
            )}
          />
          <div className="rounded-lg border border-border-light px-3 py-3">
            <p className="text-sidebar-row text-sidebar-foreground">No repositories yet</p>
            <p className="mt-1 text-ui-sm text-sidebar-muted-foreground">
              Add a local folder or connect a GitHub repository to start a workspace.
            </p>
          </div>
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** The `footer` slot holds the release notice above the account row. */
export const FooterSlot = () => (
  <SidebarBox height={420}>
    <ProductSidebarFrame
      footer={(
        <>
          <div className="mx-2 mb-1 rounded-lg border border-border bg-surface-elevated px-3 py-2">
            <p className="text-sidebar-row text-sidebar-foreground">Proliferate 0.14 is ready</p>
            <p className="mt-1 text-ui-sm text-sidebar-muted-foreground">
              Restart to pick up the new worktree cleanup.
            </p>
          </div>
          <AccountFooter />
        </>
      )}
    >
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
        <ProductSidebarScrollableContent>
          <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
          <ProductSidebarThreadRow
            label="Port the sidebar retune to web"
            active
            trailingLabel="9m"
            onSelect={noop}
          />
          <ProductSidebarThreadRow
            label="Flaky worktree cleanup on quit"
            trailingLabel="Mon"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);
