import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronRight,
  CloudIcon,
  FolderClosedFilled,
  FolderFilled,
  FolderRemote,
  GitPullRequest,
  MoreHorizontal,
  Plus,
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarShowToggleRow,
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
 * The header's `action` slot lives behind `opacity-0 group-hover/folder-row`
 * / `group-focus-within/folder-row`. A screenshot never hovers, so this
 * focuses the first action button on mount to show the revealed state.
 */
function RevealActionsOnFocus({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    host.current?.querySelector("button")?.focus();
  }, []);
  return <div ref={host}>{children}</div>;
}

/** Two expanded repo groups with their workspaces, and one collapsed. */
export const RepoGroupsInRail = () => (
  <SidebarBox>
    <ProductSidebarSectionHeader label="Repositories" collapsed={false} onToggleCollapsed={noop} />
    <ProductSidebarRepoGroupHeader
      label="proliferate"
      collapsed={false}
      icon={<FolderClosedFilled className="icon-paired shrink-0" />}
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
      trailingLabel="1h"
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
      trailingLabel="Tue"
      onSelect={noop}
    />
    <ProductSidebarRepoGroupHeader
      label="anyharness"
      collapsed
      icon={<FolderClosedFilled className="icon-paired shrink-0" />}
      expandedIcon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
  </SidebarBox>
);

/**
 * The environment axis: a plain local folder (closed when collapsed, open
 * when expanded) versus the fused folder+globe glyph for Cloud-capable repos.
 */
export const EnvironmentGlyphs = () => (
  <SidebarBox height={210}>
    <ProductSidebarRepoGroupHeader
      label="proliferate (local, expanded)"
      collapsed={false}
      icon={<FolderClosedFilled className="icon-paired shrink-0" />}
      expandedIcon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    <ProductSidebarRepoGroupHeader
      label="anyharness (local, collapsed)"
      collapsed
      icon={<FolderClosedFilled className="icon-paired shrink-0" />}
      expandedIcon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    <ProductSidebarRepoGroupHeader
      label="cloud-control (remote)"
      collapsed={false}
      icon={<FolderRemote className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    <ProductSidebarRepoGroupHeader
      label="a-repository-with-a-very-long-name-that-truncates"
      collapsed
      icon={<FolderClosedFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
  </SidebarBox>
);

/**
 * The header's revealed trailing actions (new workspace / repository options).
 * The `hoverIcon` glyph swap is pointer-hover only and cannot be photographed.
 */
export const HeaderActionsRevealed = () => (
  <SidebarBox height={210}>
    <RevealActionsOnFocus>
      <ProductSidebarRepoGroupHeader
        label="proliferate"
        collapsed={false}
        icon={<FolderClosedFilled className="icon-paired shrink-0" />}
        expandedIcon={<FolderFilled className="icon-paired shrink-0" />}
        hoverIcon={<ChevronRight className="icon-compact rotate-90" />}
        onToggleCollapsed={noop}
        action={(
          <>
            <SidebarActionButton title="New workspace" alwaysVisible>
              <Plus />
            </SidebarActionButton>
            <SidebarActionButton title="Repository options" alwaysVisible>
              <MoreHorizontal />
            </SidebarActionButton>
          </>
        )}
      />
    </RevealActionsOnFocus>
    <ProductSidebarWorkspaceRow
      label="design-sync-ui-import"
      active
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "open", number: 812 }}
      trailingLabel="2m"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="pr-status-dots"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "merged", number: 799 }}
      trailingLabel="Jul 4"
      onSelect={noop}
    />
  </SidebarBox>
);
