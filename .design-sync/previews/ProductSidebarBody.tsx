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
  ProductSidebarThreadRow,
  ProductSidebarWorkspaceRow,
  ProliferateIcon,
  ShortcutBadge,
  SidebarRowSurface,
  UserAvatar,
} from "@proliferate/ui";

const noop = () => {};

/**
 * `ProductSidebarBody` is the `min-h-0 flex-1 flex-col` middle of the rail:
 * it takes every pixel the frame's footer leaves and gives the scroll region
 * inside it a bounded box to clip against. Both it and the frame collapse to
 * nothing without a sized ancestor, so every cell sits in this rail box.
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
  },
  {
    id: "support",
    label: "Support",
    icon: <LifeBuoy className="icon-paired" />,
    active: false,
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

/** Body filled past the rail height: the scroll region clips, the footer stays put. */
export const BodyFillsTheRail = () => (
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
            onToggleCollapsed={noop}
          />
          {[
            "design-sync-ui-import",
            "sidebar-retune-round-4",
            "pr-status-dots",
            "worktree-cleanup-guard",
            "billing-enforce-mode",
            "cloud-provisioning-race",
            "shortcut-reveal-provider",
            "transcript-virtualisation",
          ].map((name, index) => (
            <ProductSidebarWorkspaceRow
              key={name}
              label={name}
              active={index === 0}
              leadingGlyph={<GitPullRequest className="icon-paired" />}
              prStatus={{ kind: index % 3 === 0 ? "open" : index % 3 === 1 ? "pending" : "draft" }}
              trailingLabel={index < 3 ? `${index + 2}h` : "Mon"}
              onSelect={noop}
            />
          ))}
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** Short content: the body still owns the full column, content stays top-aligned. */
export const BodyWithShortContent = () => (
  <SidebarBox height={330}>
    <ProductSidebarFrame footer={<AccountFooter />}>
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
            label="Draft release notes for 0.14"
            trailingLabel="Mon"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);

/** No footer at all — the body simply runs to the bottom of the rail. */
export const BodyWithoutFooter = () => (
  <SidebarBox height={330}>
    <ProductSidebarFrame>
      <ProductSidebarBody>
        <ProductSidebarBrandRow
          icon={<ProliferateIcon className="icon-paired" />}
          label="Proliferate"
        />
        <ProductSidebarPrimaryNavigation navItems={NAV_ITEMS} onNavSelect={noop} />
        <ProductSidebarScrollableContent>
          <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
          <ProductSidebarThreadRow
            label="Flaky worktree cleanup on quit"
            trailingLabel="Mon"
            onSelect={noop}
          />
          <ProductSidebarThreadRow
            label="Investigate PR checks timing out"
            trailingLabel="Sun"
            onSelect={noop}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  </SidebarBox>
);
