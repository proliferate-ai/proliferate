import { useEffect, useRef, type ReactNode } from "react";
import {
  CircleAlert,
  Clock,
  CloudIcon,
  FolderFilled,
  GitBranchIcon,
  GitPullRequest,
  MoreHorizontal,
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarWorkspaceRow,
  SidebarActionButton,
  Spinner,
} from "@proliferate/ui";

const noop = () => {};

function SidebarBox({ children, height = 330 }: { children: ReactNode; height?: number }) {
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

/** `hoverAction` is opacity-0 until the row is hovered or holds focus. */
function RevealHoverActionOnFocus({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    host.current?.querySelector("button")?.focus();
  }, []);
  return <div ref={host}>{children}</div>;
}

/** A repo group's workspaces: PR dot on the leading glyph, time in the trailing cell. */
export const WorkspaceList = () => (
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
      prStatus={{ kind: "checks_failing", number: 806 }}
      trailingLabel="26m"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="worktree-cleanup-guard"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "pending", number: 804 }}
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
    <ProductSidebarWorkspaceRow
      label="scratch-branch"
      leadingGlyph={<GitBranchIcon className="icon-paired" />}
      trailingLabel="Jul 2"
      onSelect={noop}
    />
  </SidebarBox>
);

/** Trailing-cell precedence: live activity, then the unread dot, then the time. */
export const ActivityAndUnread = () => (
  <SidebarBox height={290}>
    <ProductSidebarRepoGroupHeader
      label="cloud-control"
      collapsed={false}
      icon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    <ProductSidebarWorkspaceRow
      label="billing-enforce-mode"
      leadingGlyph={<CloudIcon className="icon-paired" />}
      trailingStatus={<Spinner className="size-4 text-sidebar-muted-foreground" />}
      trailingLabel="now"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="fix-provisioning-race"
      leadingGlyph={<CloudIcon className="icon-paired" />}
      trailingStatus={<Clock className="icon-paired text-warning-foreground" />}
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="stale-worktree-0f2c"
      leadingGlyph={<CloudIcon className="icon-paired" />}
      trailingStatus={<CircleAlert className="icon-paired text-destructive" />}
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="transcript-virtualisation"
      leadingGlyph={<CloudIcon className="icon-paired" />}
      unreadDot
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="settings-scope-tabs"
      archived
      leadingGlyph={<CloudIcon className="icon-paired" />}
      trailingLabel="Jun 28"
      onSelect={noop}
    />
  </SidebarBox>
);

/** Subtitle rows are 40px tall and carry the branch under the workspace name. */
export const SubtitleRows = () => (
  <SidebarBox height={255}>
    <ProductSidebarRepoGroupHeader
      label="proliferate"
      collapsed={false}
      icon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    <ProductSidebarWorkspaceRow
      label="design-sync-ui-import"
      subtitle="claude/design-sync-ui-import"
      active
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "open", number: 812 }}
      trailingLabel="2m"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="sidebar-retune-round-4"
      subtitle="pablo/sidebar-retune"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "changes_requested", number: 806 }}
      trailingLabel="26m"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="worktree-cleanup-guard"
      subtitle="a-very-long-branch-name-that-has-to-truncate-here"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "draft", number: 804 }}
      trailingLabel="1h"
      onSelect={noop}
    />
  </SidebarBox>
);

/** Shortcut reveal (⌘ held) and the hover-revealed row menu. */
export const ShortcutAndHoverAction = () => (
  <SidebarBox height={255}>
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
      shortcutLabel="⌘1"
      shortcutRevealVisible
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="sidebar-retune-round-4"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "pending", number: 806 }}
      shortcutLabel="⌘2"
      shortcutRevealVisible
      onSelect={noop}
    />
    <RevealHoverActionOnFocus>
      <ProductSidebarWorkspaceRow
        label="pr-status-dots"
        leadingGlyph={<GitPullRequest className="icon-paired" />}
        prStatus={{ kind: "merged", number: 799 }}
        trailingLabel="Jul 4"
        hoverAction={(
          <SidebarActionButton title="Workspace options" alwaysVisible>
            <MoreHorizontal />
          </SidebarActionButton>
        )}
        onSelect={noop}
      />
    </RevealHoverActionOnFocus>
  </SidebarBox>
);
