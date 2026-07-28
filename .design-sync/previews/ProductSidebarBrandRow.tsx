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
  Building2,
} from "@proliferate/ui";

const noop = () => {};

function SidebarBox({ children, height = 420 }: { children: ReactNode; height?: number }) {
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
  },
  {
    id: "support",
    label: "Support",
    icon: <LifeBuoy className="icon-paired" />,
    active: false,
  },
];

/**
 * The brand row's `px-4` is deliberate: it puts the wordmark on the same left
 * edge as the nav glyphs and the section labels below it, which is only
 * visible when the rest of the rail is there to line up against.
 */
export const BrandRowInRail = () => (
  <SidebarBox height={360}>
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
            active
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "open", number: 812 }}
            trailingLabel="2m"
            onSelect={noop}
          />
          <ProductSidebarWorkspaceRow
            label="sidebar-retune-round-4"
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "draft", number: 806 }}
            trailingLabel="1h"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** The mark slot takes any glyph; the wordmark keeps its 17px/24 semibold ramp. */
export const MarkVariants = () => (
  <div className="w-72 rounded-lg border border-border bg-sidebar py-2 text-sidebar-foreground">
    <ProductSidebarBrandRow
      icon={<ProliferateIcon className="icon-paired" />}
      label="Proliferate"
    />
    <ProductSidebarBrandRow icon={<Building2 className="icon-paired" />} label="Acme Robotics" />
    <ProductSidebarBrandRow label="Proliferate" />
    <ProductSidebarBrandRow
      icon={<ProliferateIcon className="icon-paired" />}
      label="Proliferate Enterprise Cloud"
    />
  </div>
);

/** Without an icon the wordmark still starts on the nav's 16px content edge. */
export const AlignsWithNavigation = () => (
  <SidebarBox height={220}>
    <ProductSidebarFrame>
      <ProductSidebarBody>
        <ProductSidebarBrandRow label="Proliferate" />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);
