import type { ReactNode } from "react";
import {
  AppShellNewChatIcon,
  Blocks,
  FolderFilled,
  GitPullRequest,
  Grid,
  LifeBuoy,
  ProductSidebarBody,
  ProductSidebarBrandRow,
  ProductSidebarFrame,
  ProductSidebarPrimaryNavigation,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarWorkspaceRow,
  ProliferateIcon,
} from "@proliferate/ui";

const noop = () => {};

function SidebarBox({ children, height = 250 }: { children: ReactNode; height?: number }) {
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-border" style={{ height }}>
      {children}
    </div>
  );
}

/** Exactly the item set MainSidebar ships, including the Workflows beta chip. */
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

const WORKSPACES_ACTIVE = NAV_ITEMS.map((item) => ({
  ...item,
  active: item.id === "workspaces",
}));

/** The nav under the brand row, where it actually lives. */
export const PrimaryNavigation = () => (
  <SidebarBox>
    <ProductSidebarFrame>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** Holding ⌘ reveals every row's shortcut badge at once. */
export const ShortcutRevealHeld = () => (
  <SidebarBox>
    <ProductSidebarFrame>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation
          navItems={WORKSPACES_ACTIVE}
          onNavSelect={noop}
          shortcutRevealVisible
        />
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** In full context: nav on top, repositories scrolling underneath. */
export const AboveTheRepositories = () => (
  <SidebarBox height={460}>
    <ProductSidebarFrame>
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
            onToggleCollapsed={noop}
          />
          <ProductSidebarWorkspaceRow
            label="design-sync-ui-import"
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "open", number: 812 }}
            trailingLabel="2m"
            onSelect={noop}
          />
          <ProductSidebarWorkspaceRow
            label="sidebar-retune-round-4"
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "pending", number: 806 }}
            trailingLabel="1h"
            onSelect={noop}
          />
          <ProductSidebarWorkspaceRow
            label="pr-status-dots"
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "merged", number: 799 }}
            trailingLabel="Jul 4"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);
