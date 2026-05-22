import {
  Blocks,
  CalendarClock,
  Cloud,
  CloudOff,
  House,
  LifeBuoy,
  MessageSquare,
  Settings,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";
import type {
  SidebarActionEvent,
  SidebarChatRowView,
  SidebarNavItemView,
  SidebarWorkspaceGroupView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import { ProductSidebar } from "@proliferate/product-ui/sidebar/ProductSidebar";

import { routes } from "../../../config/routes";

export function WebSidebarController() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const workspaces = useCloudWorkspaces({ scope: "exposed" });
  const cloudWorkspaces = workspaces.data ?? [];

  const navItems = useMemo(
    () => buildNavItems(location.pathname),
    [location.pathname],
  );
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(cloudWorkspaces, location.pathname, collapsedGroupIds),
    [cloudWorkspaces, collapsedGroupIds, location.pathname],
  );
  const chatRows = useMemo(
    () => buildChatRows(cloudWorkspaces, location.pathname),
    [cloudWorkspaces, location.pathname],
  );
  const chatWorkspaceBySessionId = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const workspace of cloudWorkspaces) {
      const sessionId = workspace.lastSessionSummary?.sessionId;
      if (sessionId) {
        lookup.set(sessionId, workspace.id);
      }
    }
    return lookup;
  }, [cloudWorkspaces]);

  function navigateByNavId(id: string) {
    switch (id) {
      case "home":
        navigate(routes.home);
        return;
      case "workspaces":
        navigate(routes.workspaces);
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

  function handleWorkspaceSelect(workspaceId: string) {
    navigate(routes.workspace(workspaceId));
  }

  function handleChatSelect(sessionId: string) {
    const workspaceId = chatWorkspaceBySessionId.get(sessionId);
    if (!workspaceId) {
      return;
    }
    navigate(routes.chat(workspaceId, sessionId));
  }

  function handleGroupToggle(groupId: string) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
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
        onWorkspaceSelect={handleWorkspaceSelect}
        onChatSelect={handleChatSelect}
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
      icon: <House className="size-4" />,
      active: pathname === routes.home,
    },
    {
      id: "workspaces",
      label: "Workspaces",
      icon: <Cloud className="size-4" />,
      active: pathname.startsWith(routes.workspaces),
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <Blocks className="size-4" />,
      active: pathname.startsWith(routes.plugins),
    },
    {
      id: "automations",
      label: "Automations",
      icon: <CalendarClock className="size-4" />,
      active: pathname.startsWith(routes.automations),
    },
    {
      id: "support",
      label: "Support",
      icon: <LifeBuoy className="size-4" />,
      active: pathname.startsWith(routes.support),
    },
  ];
}

function buildWorkspaceGroups(
  workspaces: CloudWorkspaceSummary[],
  pathname: string,
  collapsedGroupIds: ReadonlySet<string>,
): SidebarWorkspaceGroupView[] {
  const groups = new Map<string, CloudWorkspaceSummary[]>();
  for (const workspace of sortedWorkspaces(workspaces)) {
    const groupId = repoGroupId(workspace);
    const group = groups.get(groupId);
    if (group) {
      group.push(workspace);
    } else {
      groups.set(groupId, [workspace]);
    }
  }

  return Array.from(groups.entries()).map(([groupId, groupWorkspaces]) => ({
    id: groupId,
    label: repoGroupLabel(groupWorkspaces[0]),
    count: groupWorkspaces.length,
    collapsed: collapsedGroupIds.has(groupId),
    icon: <Cloud className="size-4" />,
    expandedIcon: <Cloud className="size-4" />,
    rows: groupWorkspaces.map((workspace) => ({
      id: workspace.id,
      label: workspaceRowLabel(workspace),
      active: isWorkspaceRouteActive(pathname, workspace.id),
      archived: workspace.status === "archived" || workspace.visibility === "archived",
      status: workspaceStatusIcon(workspace),
      detail: workspace.visibility !== "private" ? (
        <Users className="size-3.5" aria-label={workspaceVisibilityLabel(workspace)} />
      ) : null,
      trailingLabel: workspaceTrailingLabel(workspace),
      actions: [],
    })),
    actions: [],
  }));
}

function buildChatRows(
  workspaces: CloudWorkspaceSummary[],
  pathname: string,
): SidebarChatRowView[] {
  return sortedWorkspaces(workspaces)
    .filter((workspace) => Boolean(workspace.lastSessionSummary?.sessionId))
    .slice(0, 12)
    .map((workspace) => {
      const session = workspace.lastSessionSummary!;
      return {
        id: session.sessionId,
        label: session.title ?? workspace.displayName ?? workspace.repo.name,
        subtitle: workspace.displayName ?? null,
        active: pathname === routes.chat(workspace.id, session.sessionId),
        status: <MessageSquare className="size-3.5" />,
        detail: workspace.visibility !== "private" ? <Users className="size-3.5" /> : null,
        trailingLabel: session.status,
        actions: [],
      };
    });
}

function sortedWorkspaces(workspaces: CloudWorkspaceSummary[]): CloudWorkspaceSummary[] {
  return [...workspaces].sort((left, right) => {
    const leftTime = workspaceSortTime(left);
    const rightTime = workspaceSortTime(right);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return workspaceRowLabel(left).localeCompare(workspaceRowLabel(right));
  });
}

function workspaceSortTime(workspace: CloudWorkspaceSummary): number {
  const timestamp =
    workspace.lastSessionSummary?.lastEventAt ??
    workspace.lastActivityAt ??
    workspace.updatedAt ??
    workspace.createdAt;
  return timestamp ? Date.parse(timestamp) || 0 : 0;
}

function repoGroupId(workspace: CloudWorkspaceSummary): string {
  return `${workspace.repo.owner}/${workspace.repo.name}`;
}

function repoGroupLabel(workspace: CloudWorkspaceSummary): string {
  return `${workspace.repo.owner}/${workspace.repo.name}`;
}

function workspaceRowLabel(workspace: CloudWorkspaceSummary): string {
  return workspace.displayName ?? workspace.repo.branch ?? workspace.repo.baseBranch ?? "Cloud workspace";
}

function workspaceTrailingLabel(workspace: CloudWorkspaceSummary): string {
  if (workspace.visibility === "shared_unclaimed") {
    return "team";
  }
  if (workspace.visibility === "claimed") {
    return "claimed";
  }
  if (workspace.sandboxType === "managed_shared") {
    return "shared";
  }
  if (workspace.sandboxType === "ssh") {
    return "ssh";
  }
  return workspace.status;
}

function workspaceVisibilityLabel(workspace: CloudWorkspaceSummary): string {
  if (workspace.visibility === "shared_unclaimed") {
    return "Shared unclaimed";
  }
  if (workspace.visibility === "claimed") {
    return "Claimed";
  }
  return workspace.visibility;
}

function workspaceStatusIcon(workspace: CloudWorkspaceSummary) {
  if (workspace.status === "archived" || workspace.exposureState === "revoked") {
    return <CloudOff className="size-3.5 text-sidebar-muted-foreground" />;
  }
  if (workspace.status === "error" || workspace.exposureState === "stale") {
    return <span className="size-2 rounded-full bg-destructive" aria-label="Needs attention" />;
  }
  if (workspace.status === "ready") {
    return <span className="size-2 rounded-full bg-emerald-500" aria-label="Ready" />;
  }
  return <span className="size-2 rounded-full bg-amber-500" aria-label="Starting" />;
}

function isWorkspaceRouteActive(pathname: string, workspaceId: string): boolean {
  return (
    pathname === routes.workspace(workspaceId) ||
    pathname.startsWith(`${routes.workspace(workspaceId)}/`)
  );
}
