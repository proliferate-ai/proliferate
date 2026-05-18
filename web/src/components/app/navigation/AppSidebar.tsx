import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  Hand,
  Home,
  MoreHorizontal,
  Plug,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  deriveClaimState,
  isTeamChat,
} from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation } from "@proliferate/product-model/chats/presentation";
import type { ProductChat, ProductWorkspace } from "@proliferate/product-model/chats/model";

import { routes } from "../../../config/routes";
import {
  chats,
  currentUser,
  workspaces,
  workspaceForChat,
} from "../../../lib/fixtures/web-fixtures";
import { ProliferateMark } from "./ProliferateMark";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const navItems: NavItem[] = [
  { to: routes.home, label: "Home", icon: Home },
  { to: routes.automations, label: "Automations", icon: CalendarClock },
  { to: routes.plugins, label: "Plugins & MCPs", icon: Plug },
  { to: routes.support, label: "Support", icon: CircleHelp },
];

function chatStatusClass(status: ProductChat["status"]) {
  switch (status) {
    case "running":
      return "bg-success";
    case "failed":
      return "bg-destructive";
    case "done":
      return "bg-info";
    default:
      return "bg-muted-foreground/60";
  }
}

function ChatRow({ chat }: { chat: ProductChat }) {
  const navigate = useNavigate();
  const presentation = chatKindPresentation(chat.kind);
  const claimState = deriveClaimState(chat, currentUser);

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      onClick={() => navigate(routes.chat(chat.workspaceId, chat.id))}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-sidebar-foreground hover:bg-sidebar-accent"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${chatStatusClass(chat.status)}`} />
      <span className="min-w-0 flex-1 truncate font-[450]">{chat.title}</span>
      {claimState.kind === "unclaimed" ? (
        <Hand size={11} className="shrink-0 text-success" />
      ) : null}
      <span className="shrink-0 text-[10.5px] text-sidebar-muted-foreground">
        {presentation.label}
      </span>
      <MoreHorizontal size={14} className="shrink-0 text-sidebar-muted-foreground opacity-0 group-hover:opacity-100" />
    </Button>
  );
}

function UnclaimedSection() {
  const navigate = useNavigate();
  const unclaimed = chats.filter(
    (chat) => isTeamChat(chat.kind) && deriveClaimState(chat, currentUser).kind === "unclaimed",
  );
  if (unclaimed.length === 0) return null;

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <Hand size={11} className="text-success" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
          Unclaimed
        </span>
        <span className="ml-auto rounded-full bg-success-subtle px-1.5 text-[10px] font-medium text-success">
          {unclaimed.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {unclaimed.map((chat) => {
          const workspace = workspaceForChat(chat);
          return (
            <button
              key={chat.id}
              type="button"
              onClick={() => navigate(routes.chat(chat.workspaceId, chat.id))}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-success" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-[450]">{chat.title}</span>
                <span className="block truncate text-[10.5px] text-sidebar-muted-foreground">
                  {workspace?.name ?? "Unknown"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface WorkspaceGroupProps {
  workspace: ProductWorkspace;
  chats: ProductChat[];
}

function WorkspaceGroup({ workspace, chats: workspaceChats }: WorkspaceGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-sidebar-foreground hover:bg-sidebar-accent"
      >
        {open ? (
          <ChevronDown size={12} className="text-sidebar-muted-foreground" />
        ) : (
          <ChevronRight size={12} className="text-sidebar-muted-foreground" />
        )}
        {workspace.kind === "shared" ? (
          <Users size={12} className="text-sidebar-muted-foreground" />
        ) : (
          <Folder size={12} className="text-sidebar-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
        <span className="text-[10px] text-sidebar-muted-foreground">{workspaceChats.length}</span>
      </button>
      {open && (
        <div className="space-y-0.5 pb-1 pl-3">
          {workspaceChats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} />
          ))}
          {workspaceChats.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-sidebar-muted-foreground">No chats</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const sharedWorkspaces = workspaces.filter((workspace) => workspace.kind === "shared");
  const personalWorkspaces = workspaces.filter((workspace) => workspace.kind !== "shared");

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
        <div className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground">
          <ProliferateMark size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold tracking-tight">Proliferate</div>
        </div>
        <IconButton title="New chat" tone="sidebar" size="sm">
          <Plus size={14} />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === routes.home}
              className={({ isActive }) =>
                `flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] font-[450] transition-colors ${
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

      <div className="border-t border-sidebar-border" />

      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <UnclaimedSection />

        {sharedWorkspaces.length > 0 ? (
          <>
            <div className="px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
              Shared
            </div>
            {sharedWorkspaces.map((workspace) => (
              <WorkspaceGroup
                key={workspace.id}
                workspace={workspace}
                chats={chats.filter((chat) => chat.workspaceId === workspace.id)}
              />
            ))}
          </>
        ) : null}

        {personalWorkspaces.length > 0 ? (
          <>
            <div className="px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
              Personal
            </div>
            {personalWorkspaces.map((workspace) => (
              <WorkspaceGroup
                key={workspace.id}
                workspace={workspace}
                chats={chats.filter((chat) => chat.workspaceId === workspace.id)}
              />
            ))}
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2">
        <div className="flex size-7 items-center justify-center rounded-full bg-info-subtle text-[11px] font-bold text-info">
          PH
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-sidebar-foreground">
            Pablo Hansen
          </div>
          <div className="truncate text-[10.5px] text-sidebar-muted-foreground">
            pablo@proliferate.ai
          </div>
        </div>
        <NavLink
          to={routes.settings}
          className={({ isActive }) =>
            `flex size-7 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-foreground" : ""
            }`
          }
          title="Settings"
        >
          <Settings size={13} />
        </NavLink>
      </div>
    </aside>
  );
}
