import type { ReactNode } from "react";
import {
  CloudIcon,
  FolderFilled,
  FolderRemote,
  GitPullRequest,
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarRepoGroupHeader,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarShowToggleRow,
  ProductSidebarWorkspaceRow,
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

/**
 * The row is a quiet pill under a truncated repo group — it sits on the
 * `pl-6` indent so it reads as belonging to the group's rows, not to the
 * section above.
 */
export const ShowMoreUnderAGroup = () => (
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
      trailingLabel="26m"
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="pr-status-dots"
      leadingGlyph={<GitPullRequest className="icon-paired" />}
      prStatus={{ kind: "merged", number: 799 }}
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
  </SidebarBox>
);

/** The expanded counterpart, closing a fully-listed group. */
export const ShowLessAfterExpanding = () => (
  <SidebarBox height={295}>
    <ProductSidebarRepoGroupHeader
      label="anyharness"
      collapsed={false}
      icon={<FolderFilled className="icon-paired shrink-0" />}
      onToggleCollapsed={noop}
    />
    {[
      "sdk-cowork-threads",
      "harness-restart-guard",
      "session-activity-reconciler",
      "tool-call-streaming",
      "transcript-row-provider",
    ].map((name, index) => (
      <ProductSidebarWorkspaceRow
        key={name}
        label={name}
        active={index === 0}
        leadingGlyph={<GitPullRequest className="icon-paired" />}
        prStatus={{ kind: index === 0 ? "open" : "draft" }}
        trailingLabel={index < 2 ? `${index + 3}h` : "Mon"}
        onSelect={noop}
      />
    ))}
    <ProductSidebarShowToggleRow label="Show less" onClick={noop} />
  </SidebarBox>
);

