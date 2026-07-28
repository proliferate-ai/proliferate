import type { ReactNode } from "react";
import {
  AppShellNewChatIcon,
  Blocks,
  Grid,
  History,
  LifeBuoy,
  ProductSidebarBody,
  ProductSidebarBrandRow,
  ProductSidebarFrame,
  ProductSidebarNavRow,
  ProliferateIcon,
  Settings,
} from "@proliferate/ui";

const noop = () => {};

/** The rows only make sense on the rail's own grid, so every cell sits in one. */
function NavRail({ children, height = 210 }: { children: ReactNode; height?: number }) {
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-border" style={{ height }}>
      <ProductSidebarFrame>
        <ProductSidebarBody>
          <ProductSidebarBrandRow
            icon={<ProliferateIcon className="icon-paired" />}
            label="Proliferate"
          />
          <nav className="px-2">
            <div className="flex flex-col gap-px">{children}</div>
          </nav>
        </ProductSidebarBody>
      </ProductSidebarFrame>
    </div>
  );
}

/** The shipped primary-nav set, "New chat" selected. */
export const NavRows = () => (
  <NavRail>
    <ProductSidebarNavRow
      item={{
        id: "new-chat",
        label: "New chat",
        icon: <AppShellNewChatIcon className="icon-paired" />,
        active: true,
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "workspaces",
        label: "Workspaces",
        icon: <Grid className="icon-paired" />,
        active: false,
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "workflows",
        label: "Workflows",
        icon: <Blocks className="icon-paired" />,
        active: false,
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "support",
        label: "Support",
        icon: <LifeBuoy className="icon-paired" />,
        active: false,
      }}
      onSelect={noop}
    />
  </NavRail>
);

/**
 * `shortcutLabel` renders its badge at `opacity-0` unless
 * `shortcutRevealVisible` is passed too — this is the ⌘-held reveal state.
 */
export const ShortcutReveal = () => (
  <NavRail>
    <ProductSidebarNavRow
      item={{
        id: "new-chat",
        label: "New chat",
        icon: <AppShellNewChatIcon className="icon-paired" />,
        active: true,
        shortcutLabel: "⌘N",
      }}
      onSelect={noop}
      shortcutRevealVisible
    />
    <ProductSidebarNavRow
      item={{
        id: "workspaces",
        label: "Workspaces",
        icon: <Grid className="icon-paired" />,
        active: false,
        shortcutLabel: "⌘1",
      }}
      onSelect={noop}
      shortcutRevealVisible
    />
    <ProductSidebarNavRow
      item={{
        id: "support",
        label: "Support",
        icon: <LifeBuoy className="icon-paired" />,
        active: false,
        shortcutLabel: "⌘/",
      }}
      onSelect={noop}
      shortcutRevealVisible
    />
    <ProductSidebarNavRow
      item={{
        id: "settings",
        label: "Settings",
        icon: <Settings className="icon-paired" />,
        active: false,
        shortcutLabel: "⌘,",
      }}
      onSelect={noop}
      shortcutRevealVisible
    />
  </NavRail>
);

/** Status slot, disabled rows and truncation, all on the nav's 13px tier. */
export const StatusAndStates = () => (
  <NavRail height={230}>
    <ProductSidebarNavRow
      item={{
        id: "workflows",
        label: "Workflows",
        icon: <Blocks className="icon-paired" />,
        active: false,
        status: (
          <span className="font-mono text-ui-sm uppercase tracking-wide text-sidebar-muted-foreground">
            beta
          </span>
        ),
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "history",
        label: "History",
        icon: <History className="icon-paired" />,
        active: false,
        status: "12",
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "support",
        label: "Support",
        icon: <LifeBuoy className="icon-paired" />,
        active: false,
        disabled: true,
      }}
      onSelect={noop}
    />
    <ProductSidebarNavRow
      item={{
        id: "workspaces",
        label: "Workspaces on this machine and in the cloud",
        icon: <Grid className="icon-paired" />,
        active: false,
      }}
      onSelect={noop}
    />
  </NavRail>
);
