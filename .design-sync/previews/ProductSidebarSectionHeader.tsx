import { useEffect, useRef, type ReactNode } from "react";
import {
  CloudIcon,
  Filter,
  FolderFilled,
  FolderRemote,
  GitPullRequest,
  Plus,
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarThreadRow,
  ProductSidebarWorkspaceRow,
  SidebarActionButton,
} from "@proliferate/ui";

const noop = () => {};

function SidebarBox({ children, height = 440 }: { children: ReactNode; height?: number }) {
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-border" style={{ height }}>
      <ProductSidebarFrame>
        <ProductSidebarBody>
          <ProductSidebarScrollableContent>{children}</ProductSidebarScrollableContent>
        </ProductSidebarBody>
      </ProductSidebarFrame>
    </div>
  );
}

/**
 * The header's `actions` slot is `opacity-0` until the row is hovered OR
 * something inside it takes focus. Captures never hover, so this focuses the
 * first action on mount to photograph the revealed state honestly.
 */
function RevealActionsOnFocus({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    host.current?.querySelector("button")?.focus();
  }, []);
  return <div ref={host}>{children}</div>;
}

/** Toggleable "Repositories" header over its real body, plus a static header. */
export const SectionsInRail = () => (
  <SidebarBox>
    <ProductSidebarSectionHeader label="Repositories" collapsed={false} onToggleCollapsed={noop} />
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
      prStatus={{ kind: "pending", number: 806 }}
      trailingLabel="1h"
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
    {/* No onToggleCollapsed: a purely static header for a section with no body. */}
    <ProductSidebarSectionHeader label="Cleanup" />
    <ProductSidebarWorkspaceRow
      label="stale-worktree-0f2c"
      archived
      leadingGlyph={<CloudIcon className="icon-paired" />}
      trailingLabel="Jul 9"
      onSelect={noop}
    />
  </SidebarBox>
);

/**
 * Collapsed: the disclosure chevron is the one piece of chrome that stays
 * visible at rest (expanded, it hides until hover/focus).
 */
export const CollapsedSections = () => (
  <SidebarBox height={240}>
    <ProductSidebarSectionHeader label="Repositories" collapsed onToggleCollapsed={noop} />
    <ProductSidebarSectionHeader label="Chats" collapsed onToggleCollapsed={noop} />
    <ProductSidebarSectionHeader label="Cleanup" />
    <ProductSidebarSectionHeader label="Archived" collapsed={false} onToggleCollapsed={noop} />
    <ProductSidebarWorkspaceRow
      label="pr-status-dots"
      archived
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "merged", number: 799 }}
      trailingLabel="Jul 4"
      onSelect={noop}
    />
  </SidebarBox>
);

/** The hover/focus-revealed actions slot, shown in its revealed state. */
export const HeaderActionsRevealed = () => (
  <SidebarBox height={240}>
    <RevealActionsOnFocus>
      <ProductSidebarSectionHeader
        label="Repositories"
        collapsed={false}
        onToggleCollapsed={noop}
        actions={(
          <>
            <SidebarActionButton title="Filter workspaces" variant="section">
              <Filter />
            </SidebarActionButton>
            <SidebarActionButton title="Add repository" variant="section">
              <Plus />
            </SidebarActionButton>
          </>
        )}
      />
    </RevealActionsOnFocus>
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
    <ProductSidebarWorkspaceRow
      label="fix-provisioning-race"
      leadingGlyph={<CloudIcon className="icon-paired" />}
      unreadDot
      onSelect={noop}
    />
  </SidebarBox>
);
