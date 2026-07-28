import {
  ChevronDown,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Plus,
  SidebarActionButton,
  SidebarRowSurface,
  Trash,
} from "@proliferate/ui";

const noop = () => {};

export const Variants = () => (
  <div className="flex items-center gap-6 rounded-lg bg-sidebar-background p-3">
    <div className="flex flex-col items-center gap-2">
      <SidebarActionButton title="New chat" alwaysVisible onClick={noop}>
        <Plus />
      </SidebarActionButton>
      <span className="text-ui-sm text-sidebar-muted-foreground">default</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <SidebarActionButton title="Collapse section" variant="section" onClick={noop}>
        <ChevronDown />
      </SidebarActionButton>
      <span className="text-ui-sm text-sidebar-muted-foreground">section</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <SidebarActionButton title="Session options" alwaysVisible active onClick={noop}>
        <MoreHorizontal />
      </SidebarActionButton>
      <span className="text-ui-sm text-sidebar-muted-foreground">active</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <SidebarActionButton title="Delete session" alwaysVisible disabled onClick={noop}>
        <Trash />
      </SidebarActionButton>
      <span className="text-ui-sm text-sidebar-muted-foreground">disabled</span>
    </div>
  </div>
);

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex h-7 items-center gap-1 px-2">
      <SidebarActionButton title={`Collapse ${label}`} variant="section" onClick={noop}>
        <ChevronDown />
      </SidebarActionButton>
      <span className="flex-1 font-mono text-ui-sm font-medium uppercase tracking-[0.06em] text-sidebar-muted-foreground">
        {label}
      </span>
      <SidebarActionButton title={`New ${label}`} variant="section" onClick={noop}>
        <Plus />
      </SidebarActionButton>
    </div>
  );
}

export const InSectionHeader = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SectionHeader label="Sessions" />
    <SidebarRowSurface as="button" active onPress={noop} className="h-[30px] gap-2 px-2">
      <MessageSquare className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">Port playground previews</span>
    </SidebarRowSurface>
    <SectionHeader label="Branches" />
    <SidebarRowSurface as="button" onPress={noop} className="h-[30px] gap-2 px-2">
      <GitBranch className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">claude/design-sync-ui-import</span>
    </SidebarRowSurface>
    <SectionHeader label="Terminals" />
  </div>
);

export const InRowTrailing = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarRowSurface as="button" active onPress={noop} className="h-[30px] gap-2 px-2">
      <MessageSquare className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">Port playground previews</span>
      <SidebarActionButton title="Session options" alwaysVisible onClick={noop}>
        <MoreHorizontal />
      </SidebarActionButton>
      <SidebarActionButton title="Delete session" alwaysVisible onClick={noop}>
        <Trash />
      </SidebarActionButton>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-[30px] gap-2 px-2">
      <MessageSquare className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">Retune sidebar rows</span>
      <SidebarActionButton title="Session options" alwaysVisible onClick={noop}>
        <MoreHorizontal />
      </SidebarActionButton>
      <SidebarActionButton title="Delete session" alwaysVisible onClick={noop}>
        <Trash />
      </SidebarActionButton>
    </SidebarRowSurface>
    <SidebarRowSurface as="button" onPress={noop} className="h-[30px] gap-2 px-2">
      <MessageSquare className="icon-paired shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sidebar-row">Grade capture sheets</span>
      <SidebarActionButton title="Session options" alwaysVisible active onClick={noop}>
        <MoreHorizontal />
      </SidebarActionButton>
      <SidebarActionButton title="Delete session" alwaysVisible disabled onClick={noop}>
        <Trash />
      </SidebarActionButton>
    </SidebarRowSurface>
  </div>
);
