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
} from "@proliferate/ui";

const noop = () => {};

/**
 * The scroll region is `min-h-0 flex-1 overflow-hidden` around an
 * AutoHideScrollArea, so it only exists inside a bounded rail. Its own
 * `px-2` viewport padding is what sets the content grid every row aligns to.
 */
function SidebarBox({ children, height = 520 }: { children: ReactNode; height?: number }) {
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

const WORKSPACES = [
  "design-sync-ui-import",
  "sidebar-retune-round-4",
  "pr-status-dots",
  "worktree-cleanup-guard",
  "shortcut-reveal-provider",
  "transcript-virtualisation",
  "composer-model-picker",
  "settings-scope-tabs",
];

/** Overflowing content: the last rows clip at the rail edge instead of pushing the footer off. */
export const ScrollsPastTheRail = () => (
  <SidebarBox>
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
          {WORKSPACES.map((name, index) => (
            <ProductSidebarWorkspaceRow
              key={name}
              label={name}
              active={index === 0}
              leadingGlyph={<GitPullRequest className="icon-paired" />}
              prStatus={{ kind: index % 2 === 0 ? "open" : "pending" }}
              trailingLabel={index < 4 ? `${index + 1}h` : "Mon"}
              onSelect={noop}
            />
          ))}
          <ProductSidebarShowToggleRow label="Show less" onClick={noop} />
          <ProductSidebarRepoGroupHeader
            label="cloud-control"
            collapsed={false}
            icon={<FolderRemote className="icon-paired shrink-0" />}
            onToggleCollapsed={noop}
          />
          <ProductSidebarWorkspaceRow
            label="billing-enforce-mode"
            leadingGlyph={<CloudIcon className="icon-paired" />}
            trailingLabel="Tue"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** Two sections that fit: no clipping, and the `gap-px` row rhythm is legible. */
export const ContentThatFits = () => (
  <SidebarBox height={310}>
    <ProductSidebarFrame>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarScrollableContent>
          <ProductSidebarSectionHeader
            label="Repositories"
            collapsed={false}
            onToggleCollapsed={noop}
          />
          <ProductSidebarRepoGroupHeader
            label="anyharness"
            collapsed={false}
            icon={<FolderFilled className="icon-paired shrink-0" />}
            onToggleCollapsed={noop}
          />
          <ProductSidebarWorkspaceRow
            label="sdk-cowork-threads"
            active
            leadingGlyph={<GitPullRequest className="icon-paired" />}
            prStatus={{ kind: "open", number: 341 }}
            trailingLabel="4m"
            onSelect={noop}
          />
          <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
          <ProductSidebarThreadRow
            label="Port the sidebar retune to web"
            trailingLabel="9m"
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
