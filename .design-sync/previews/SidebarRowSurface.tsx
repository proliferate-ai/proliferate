import {
  Badge,
  GitBranch,
  MessageSquare,
  SidebarRowSurface,
  Terminal,
} from "@proliferate/ui";

const noop = () => {};

export const States = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarRowSurface as="button" active onPress={noop} className="h-8 px-2">
      <span className="text-sidebar-nav">Selected row</span>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-8 px-2">
      <span className="text-sidebar-nav">Resting row</span>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" disabled onPress={noop} className="h-8 px-2">
      <span className="text-sidebar-nav">Disabled row</span>
    </SidebarRowSurface>
    <SidebarRowSurface className="h-8 px-2">
      <span className="text-sidebar-nav">Static row (no onPress)</span>
    </SidebarRowSurface>
  </div>
);

export const SessionRows = () => (
  <div className="w-64 rounded-lg bg-sidebar-background p-1">
    <SidebarRowSurface as="button" active onPress={noop} className="h-[30px] gap-2 px-2">
      <MessageSquare className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">Port playground registry previews</span>
      <Badge tone="sidebar">3</Badge>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-[30px] gap-2 px-2">
      <GitBranch className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">claude/design-sync-ui-import</span>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-[30px] gap-2 px-2">
      <Terminal className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">pnpm -F @proliferate/product-ui build</span>
    </SidebarRowSurface>
  </div>
);

export const AsDiv = () => (
  <div className="w-64 rounded-lg bg-sidebar-background p-1">
    <SidebarRowSurface as="div" active onPress={noop} className="h-[30px] gap-2 px-2">
      <GitBranch className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">main</span>
      <Badge tone="sidebar">default</Badge>
    </SidebarRowSurface>
    <SidebarRowSurface as="div" onPress={noop} className="h-[30px] gap-2 px-2">
      <GitBranch className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">claude/design-sync-ui-import</span>
    </SidebarRowSurface>
    <SidebarRowSurface as="div" className="h-[30px] gap-2 px-2">
      <Terminal className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row text-sidebar-muted-foreground">
        No terminal attached
      </span>
    </SidebarRowSurface>
  </div>
);

export const TwoLineRow = () => (
  <div className="w-64 rounded-lg bg-sidebar-background p-1">
    <SidebarRowSurface as="button" active onPress={noop} className="h-auto flex-col items-start gap-0.5 px-2 py-2">
      <span className="w-full truncate text-sidebar-row">proliferate / cloud</span>
      <span className="w-full truncate text-ui-sm text-sidebar-muted-foreground">
        Building · 2 checks running
      </span>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-auto flex-col items-start gap-0.5 px-2 py-2">
      <span className="w-full truncate text-sidebar-row">proliferate / anyharness</span>
      <span className="w-full truncate text-ui-sm text-sidebar-muted-foreground">
        Idle · last run 4h ago
      </span>
    </SidebarRowSurface>
  </div>
);
