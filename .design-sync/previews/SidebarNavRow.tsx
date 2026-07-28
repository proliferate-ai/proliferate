import {
  Clock,
  GitBranch,
  Home,
  MessageSquare,
  Search,
  Settings,
  SidebarNavRow,
  Terminal,
} from "@proliferate/ui";

const noop = () => {};

export const NavList = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarNavRow icon={<Home className="icon-paired" />} label="Home" active onPress={noop} />
    <SidebarNavRow icon={<MessageSquare className="icon-paired" />} label="Chats" onPress={noop} />
    <SidebarNavRow icon={<GitBranch className="icon-paired" />} label="Branches" onPress={noop} />
    <SidebarNavRow icon={<Terminal className="icon-paired" />} label="Terminals" onPress={noop} />
    <SidebarNavRow icon={<Settings className="icon-paired" />} label="Settings" onPress={noop} />
  </div>
);

export const WithStatus = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarNavRow
      icon={<MessageSquare className="icon-paired" />}
      label="Review queue"
      status="12"
      onPress={noop}
    />
    <SidebarNavRow
      icon={<GitBranch className="icon-paired" />}
      label="claude/design-sync-ui-import"
      status="3"
      onPress={noop}
    />
    <SidebarNavRow
      icon={<Clock className="icon-paired" />}
      label="History"
      status="Yesterday"
      onPress={noop}
    />
  </div>
);

export const WithShortcut = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarNavRow
      icon={<Search className="icon-paired" />}
      label="Search"
      shortcutLabel="⌘K"
      shortcutRevealVisible
      onPress={noop}
    />
    <SidebarNavRow
      icon={<MessageSquare className="icon-paired" />}
      label="New chat"
      shortcutLabel="⌘N"
      shortcutRevealVisible
      onPress={noop}
    />
    <SidebarNavRow
      icon={<Settings className="icon-paired" />}
      label="Settings"
      shortcutLabel="⌘,"
      shortcutRevealVisible
      onPress={noop}
    />
  </div>
);

export const States = () => (
  <div className="w-56 rounded-lg bg-sidebar-background p-1">
    <SidebarNavRow icon={<Home className="icon-paired" />} label="Active row" active onPress={noop} />
    <SidebarNavRow icon={<MessageSquare className="icon-paired" />} label="Resting row" onPress={noop} />
    <SidebarNavRow icon={<Terminal className="icon-paired" />} label="Disabled row" disabled onPress={noop} />
    <SidebarNavRow label="No icon" onPress={noop} />
    <SidebarNavRow
      icon={<GitBranch className="icon-paired" />}
      label="A very long branch name that has to truncate"
      onPress={noop}
    />
  </div>
);
