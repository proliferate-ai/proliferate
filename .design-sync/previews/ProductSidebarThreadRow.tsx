import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronRight,
  CircleAlert,
  Clock,
  IconButton,
  MoreHorizontal,
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
  ProductSidebarThreadRow,
  ProductSidebarWorkspaceRow,
  SidebarActionButton,
  Spinner,
} from "@proliferate/ui";

const noop = () => {};

function SidebarBox({ children, height = 320 }: { children: ReactNode; height?: number }) {
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

/** A Chats section: one selected thread, relative times in the trailing cell. */
export const ThreadList = () => (
  <SidebarBox>
    <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
    <ProductSidebarThreadRow
      label="Port the sidebar retune to web"
      active
      trailingLabel="9m"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Flaky worktree cleanup on quit"
      trailingLabel="1h"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Draft release notes for 0.14"
      trailingLabel="Mon"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Why does the PR status dot flicker on hover?"
      trailingLabel="Sun"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Audit shortcut registry for duplicates"
      trailingLabel="Jul 9"
      onSelect={noop}
    />
  </SidebarBox>
);

/** Live activity owns the trailing cell and wins over the relative time. */
export const ActivityStates = () => (
  <SidebarBox height={250}>
    <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
    <ProductSidebarThreadRow
      label="Port the sidebar retune to web"
      active
      trailingStatus={<Spinner className="size-4 text-sidebar-muted-foreground" />}
      trailingLabel="now"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Migrate cowork threads to the SDK"
      trailingStatus={<Clock className="icon-paired text-warning-foreground" />}
      trailingLabel="4m"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Retry failed cleanup for stale-worktree-0f2c"
      trailingStatus={<CircleAlert className="icon-paired text-destructive" />}
      trailingLabel="12m"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Draft release notes for 0.14"
      trailingLabel="Mon"
      onSelect={noop}
    />
  </SidebarBox>
);

/** Subtitle rows go to 40px; `expandControl` holds the coding-workspace disclosure. */
export const SubtitlesAndExpandControl = () => (
  <SidebarBox height={280}>
    <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
    <ProductSidebarThreadRow
      label="Port the sidebar retune to web"
      subtitle="proliferate · claude/design-sync-ui-import"
      active
      expandControl={(
        <IconButton tone="sidebar" size="xs" title="Hide coding workspaces">
          <ChevronRight className="icon-compact rotate-90" />
        </IconButton>
      )}
      onSelect={noop}
    />
    <ProductSidebarWorkspaceRow
      label="design-sync-ui-import"
      className="pl-6"
      trailingLabel="2m"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Flaky worktree cleanup on quit"
      subtitle="anyharness · main"
      expandControl={(
        <IconButton tone="sidebar" size="xs" title="Show coding workspaces">
          <ChevronRight className="icon-compact" />
        </IconButton>
      )}
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Draft release notes for 0.14"
      subtitle="No workspace yet"
      trailingLabel="Mon"
      onSelect={noop}
    />
  </SidebarBox>
);

/** The hover-revealed row action, photographed in its revealed state. */
export const HoverActionRevealed = () => (
  <SidebarBox height={215}>
    <ProductSidebarSectionHeader label="Chats" collapsed={false} onToggleCollapsed={noop} />
    <RevealHoverActionOnFocus>
      <ProductSidebarThreadRow
        label="Port the sidebar retune to web"
        trailingLabel="9m"
        hoverAction={(
          <SidebarActionButton title="Thread options" alwaysVisible>
            <MoreHorizontal />
          </SidebarActionButton>
        )}
        onSelect={noop}
      />
    </RevealHoverActionOnFocus>
    <ProductSidebarThreadRow
      label="Flaky worktree cleanup on quit"
      trailingLabel="1h"
      onSelect={noop}
    />
    <ProductSidebarThreadRow
      label="Draft release notes for 0.14"
      trailingLabel="Mon"
      onSelect={noop}
    />
  </SidebarBox>
);
