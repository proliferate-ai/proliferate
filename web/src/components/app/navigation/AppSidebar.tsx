import {
  Bot,
  CircleHelp,
  Home,
  MoreHorizontal,
  PlugZap,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { deriveClaimState } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { routes } from "../../../config/routes";
import { chats, currentUser, workspaces, workspaceForChat } from "../../../lib/fixtures/web-fixtures";
import { ProliferateMark } from "./ProliferateMark";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const navItems: NavItem[] = [
  { to: routes.home, label: "Home", icon: Home },
  { to: routes.automations, label: "Automations", icon: Bot },
  { to: routes.plugins, label: "Plugins & MCPs", icon: PlugZap },
  { to: routes.support, label: "Support", icon: CircleHelp },
];

function chatStatusClass(status: ProductChat["status"]) {
  switch (status) {
    case "running":
      return "bg-success shadow-[0_0_8px_rgba(64,201,119,0.6)]";
    case "failed":
      return "bg-destructive";
    case "done":
      return "bg-info";
    default:
      return "bg-muted-foreground";
  }
}

function ChatRow({ chat }: { chat: ProductChat }) {
  const navigate = useNavigate();
  const workspace = workspaceForChat(chat);
  const presentation = chatKindPresentation(chat.kind);
  const claimLabel = claimStateLabel(deriveClaimState(chat, currentUser));

  return (
    <button
      type="button"
      onClick={() => navigate(routes.chat(chat.workspaceId, chat.id))}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${chatStatusClass(chat.status)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-[450]">{chat.title}</span>
        <span className="block truncate text-[11px] text-sidebar-muted-foreground">
          {presentation.label} - {claimLabel} - {workspace?.name ?? "Unknown"}
        </span>
      </span>
      <MoreHorizontal size={14} className="shrink-0 text-sidebar-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
}

export function AppSidebar() {
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2 px-3">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-foreground">
          <ProliferateMark size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Proliferate</div>
          <div className="truncate text-[11px] text-sidebar-muted-foreground">Cloud workspace preview</div>
        </div>
        <IconButton title="New chat" tone="sidebar" size="sm">
          <Sparkles size={14} />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sidebar-muted-foreground"
          />
          <Input
            placeholder="Search chats"
            className="h-8 border-sidebar-border bg-sidebar-accent pl-8 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground"
          />
        </div>
      </div>

      <nav className="space-y-0.5 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === routes.home}
              className={({ isActive }) =>
                `flex h-8 items-center gap-2 rounded-md px-2 text-xs font-[450] transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-3 flex items-center justify-between px-3 pb-1">
        <span className="text-[10px] font-semibold uppercase text-sidebar-muted-foreground">Workspaces</span>
        <span className="text-[10px] text-sidebar-muted-foreground">{workspaces.length}</span>
      </div>
      <div className="space-y-1 px-2">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="rounded-md px-2 py-1 text-xs text-sidebar-muted-foreground">
            <div className="truncate font-[450] text-sidebar-foreground">{workspace.name}</div>
            <div className="truncate text-[11px]">{workspace.repoLabel}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between px-3 pb-1">
        <span className="text-[10px] font-semibold uppercase text-sidebar-muted-foreground">Recent</span>
        <span className="text-[10px] text-sidebar-muted-foreground">{chats.length}</span>
      </div>
      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats.map((chat) => (
          <ChatRow key={chat.id} chat={chat} />
        ))}
      </div>

      <div className="border-t border-sidebar-border p-2">
        <NavLink
          to={routes.settings}
          className={({ isActive }) =>
            `flex h-8 items-center gap-2 rounded-md px-2 text-xs font-[450] ${
              isActive
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            }`
          }
        >
          <Settings size={14} />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
