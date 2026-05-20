import {
  Calendar,
  ChevronRight,
  CircleHelp,
  Folder,
  FolderOpen,
  Grid2X2,
  Home,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  SidebarActionEvent,
  SidebarChatRowView,
  SidebarNavItemView,
  SidebarWorkspaceGroupView,
  SidebarWorkspaceRowView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import { ProductSidebar } from "@proliferate/product-ui/sidebar/ProductSidebar";
import {
  deriveClaimState,
  isTeamChat,
} from "@proliferate/product-model/chats/claiming";
import type { ProductChat, ProductWorkspace } from "@proliferate/product-model/chats/model";

import { routes } from "../../../config/routes";
import {
  chats,
  currentUser,
  workspaceForChat,
} from "../../../lib/fixtures/web-fixtures";

export function WebSidebarController() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const navItems = useMemo(
    () => buildNavItems(location.pathname),
    [location.pathname],
  );
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(location.pathname, collapsedGroups),
    [collapsedGroups, location.pathname],
  );
  const chatRows = useMemo(
    () => buildUnclaimedRows(location.pathname),
    [location.pathname],
  );

  function navigateByNavId(id: string) {
    switch (id) {
      case "home":
        navigate(routes.home);
        return;
      case "automations":
        navigate(routes.automations);
        return;
      case "plugins":
        navigate(routes.plugins);
        return;
      case "support":
        navigate(routes.support);
        return;
      default:
        return;
    }
  }

  function handleGroupToggle(id: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleAction(event: SidebarActionEvent) {
    if (event.scope === "footer" && event.actionId === "settings") {
      navigate(routes.settings);
    }
  }

  return (
    <div className="contents" data-telemetry-block>
      <ProductSidebar
        navItems={navItems}
        workspaceGroups={workspaceGroups}
        chatRows={chatRows}
        footerActions={[
          {
            id: "settings",
            label: "Settings",
            icon: <Settings className="size-3.5" />,
          },
        ]}
        onNavSelect={navigateByNavId}
        onWorkspaceSelect={(chatId) => {
          const chat = chats.find((item) => item.id === chatId);
          if (chat) {
            navigate(routes.chat(chat.workspaceId, chat.id));
          }
        }}
        onChatSelect={(chatId) => {
          const chat = chats.find((item) => item.id === chatId);
          if (chat) {
            navigate(routes.chat(chat.workspaceId, chat.id));
          }
        }}
        onGroupToggle={handleGroupToggle}
        onAction={handleAction}
      />
    </div>
  );
}

function buildNavItems(pathname: string): SidebarNavItemView[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: <Home className="size-4" />,
      active: pathname === routes.home,
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <Grid2X2 className="size-4" />,
      active: pathname.startsWith(routes.plugins),
    },
    {
      id: "automations",
      label: "Automations",
      icon: <Calendar className="size-4" />,
      active: pathname.startsWith(routes.automations),
    },
    {
      id: "support",
      label: "Support",
      icon: <CircleHelp className="size-4" />,
      active: pathname.startsWith(routes.support),
    },
  ];
}

function buildWorkspaceGroups(
  pathname: string,
  collapsedGroups: Set<string>,
): SidebarWorkspaceGroupView[] {
  const groupsByRepo = new Map<string, {
    id: string;
    label: string;
    chats: Array<{ chat: ProductChat; workspace: ProductWorkspace }>;
  }>();

  for (const chat of chats) {
    const workspace = workspaceForChat(chat);
    if (!workspace) {
      continue;
    }
    const repoKey = repoNameFromLabel(workspace.repoLabel);
    const existing = groupsByRepo.get(repoKey);
    if (existing) {
      existing.chats.push({ chat, workspace });
      continue;
    }
    groupsByRepo.set(repoKey, {
      id: repoKey,
      label: repoKey,
      chats: [{ chat, workspace }],
    });
  }

  return [...groupsByRepo.values()].map((group) => ({
    id: group.id,
    label: group.label,
    count: group.chats.length,
    collapsed: collapsedGroups.has(group.id),
    icon: <Folder className="size-3.5 shrink-0" />,
    expandedIcon: <FolderOpen className="size-3.5 shrink-0" />,
    hoverIcon: (
      <ChevronRight
        className={`size-3 transition-transform ${collapsedGroups.has(group.id) ? "" : "rotate-90"}`}
      />
    ),
    rows: group.chats.map(({ chat }) => buildChatWorkspaceRow(chat, pathname)),
    actions: [],
  }));
}

function repoNameFromLabel(repoLabel: string): string {
  const normalized = repoLabel.trim();
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function buildChatWorkspaceRow(
  chat: ProductChat,
  pathname: string,
): SidebarWorkspaceRowView {
  return {
    id: chat.id,
    label: chat.title,
    subtitle: null,
    active: pathname === routes.chat(chat.workspaceId, chat.id),
    status: <StatusDot status={chat.status} />,
    trailingLabel: compactRecencyLabel(chat.id),
    actions: [
      {
        id: "more",
        label: "More actions",
        icon: <MoreHorizontal className="size-3.5" />,
      },
    ],
  };
}

function buildUnclaimedRows(pathname: string): SidebarChatRowView[] {
  return chats
    .filter((chat) => isTeamChat(chat.kind) && deriveClaimState(chat, currentUser).kind === "unclaimed")
    .map((chat) => ({
      id: chat.id,
      label: chat.title,
      subtitle: null,
      active: pathname === routes.chat(chat.workspaceId, chat.id),
      status: <StatusDot status={chat.status} />,
      trailingLabel: compactRecencyLabel(chat.id),
    }));
}

function compactRecencyLabel(chatId: string): string {
  const labels: Record<string, string> = {
    "slack-1": "2w",
    "automation-1": "2w",
    "shared-chat-1": "1m",
    "slack-2": "23h",
    "cloud-1": "1d",
    "dispatch-1": "2d",
    "cloud-2": "2d",
  };
  return labels[chatId] ?? "2w";
}

function StatusDot({ status }: { status: ProductChat["status"] }) {
  const className =
    status === "running"
      ? "bg-success"
      : status === "failed"
        ? "bg-destructive"
        : status === "done"
          ? "bg-info"
          : "bg-muted-foreground/60";
  return <span className={`block size-1.5 rounded-full ${className}`} />;
}
