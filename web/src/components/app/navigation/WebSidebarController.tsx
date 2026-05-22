import {
  Blocks,
  CalendarClock,
  CircleAlert,
  Cloud,
  CloudOff,
  House,
  LifeBuoy,
  LoaderCircle,
  MessageSquare,
  Plus,
  Radio,
  Settings,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useCloudWorkspaceSnapshot, useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import type {
  SidebarActionEvent,
  SidebarChatRowView,
  SidebarNavItemView,
  SidebarSectionMessageView,
  SidebarWorkspaceGroupView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import { ProductSidebar } from "@proliferate/product-ui/sidebar/ProductSidebar";

import { routes } from "../../../config/routes";
import {
  buildCloudSidebarSessionModels,
  buildCloudSidebarWorkspaceGroups,
  mergeCloudSidebarWorkspaces,
  parseCloudSidebarRoute,
  type CloudSidebarSessionModel,
  type CloudSidebarWorkspace,
  type CloudSidebarWorkspaceModel,
  type CloudSidebarRouteState,
} from "../../../lib/domain/sidebar/cloud-sidebar-model";

const EMPTY_ACTIVE_WORKSPACE_SESSIONS = [] as const;

export function WebSidebarController() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const routeState = useMemo(
    () => parseCloudSidebarRoute(location.pathname),
    [location.pathname],
  );
  const workspaces = useCloudWorkspaces({ scope: "exposed" });
  const activeWorkspaceSnapshot = useCloudWorkspaceSnapshot(
    routeState.workspaceId,
    Boolean(routeState.workspaceId),
  );
  const cloudWorkspaces = useMemo(
    () => mergeCloudSidebarWorkspaces(
      workspaces.data ?? [],
      activeWorkspaceSnapshot.data?.workspace ?? null,
    ),
    [activeWorkspaceSnapshot.data?.workspace, workspaces.data],
  );
  const activeWorkspaceSessions =
    activeWorkspaceSnapshot.data?.sessions ?? EMPTY_ACTIVE_WORKSPACE_SESSIONS;

  const navItems = useMemo(
    () => buildNavItems(location.pathname, routeState),
    [location.pathname, routeState],
  );
  const workspaceSectionMessage = useMemo(
    () => buildWorkspaceSectionMessage({
      isLoading: (workspaces.isLoading || activeWorkspaceSnapshot.isLoading) &&
        cloudWorkspaces.length === 0,
      hasError: Boolean(workspaces.error) && cloudWorkspaces.length === 0,
      hasWorkspaces: cloudWorkspaces.length > 0,
    }),
    [
      activeWorkspaceSnapshot.isLoading,
      cloudWorkspaces.length,
      workspaces.error,
      workspaces.isLoading,
    ],
  );
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups({
      workspaces: cloudWorkspaces,
      routeState,
      collapsedGroupIds,
    }),
    [cloudWorkspaces, collapsedGroupIds, routeState],
  );
  const sessionModels = useMemo(
    () => buildCloudSidebarSessionModels({
      workspaces: cloudWorkspaces,
      activeWorkspaceSessions,
      route: routeState,
    }),
    [activeWorkspaceSessions, cloudWorkspaces, routeState],
  );
  const chatRows = useMemo(
    () => buildChatRows(sessionModels),
    [sessionModels],
  );
  const chatWorkspaceBySessionId = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const session of sessionModels) {
      lookup.set(session.id, session.workspaceId);
    }
    return lookup;
  }, [sessionModels]);
  const latestSessionByWorkspaceId = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const workspace of cloudWorkspaces) {
      const sessionId = workspace.lastSessionSummary?.sessionId;
      if (sessionId) {
        lookup.set(workspace.id, sessionId);
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
    const sessionId = latestSessionByWorkspaceId.get(workspaceId);
    navigate(sessionId ? routes.chat(workspaceId, sessionId) : routes.workspace(workspaceId));
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
    if (event.scope === "header" && event.actionId === "new-chat") {
      navigate(routes.home);
      return;
    }
    if (event.scope === "footer" && event.actionId === "settings") {
      navigate(routes.settings);
      return;
    }
    if (
      event.scope === "workspace" &&
      event.actionId === "open-latest-session" &&
      event.itemId
    ) {
      const sessionId = latestSessionByWorkspaceId.get(event.itemId);
      if (sessionId) {
        navigate(routes.chat(event.itemId, sessionId));
      }
      return;
    }
    if (event.scope === "chat" && event.actionId === "open-workspace" && event.itemId) {
      const workspaceId = chatWorkspaceBySessionId.get(event.itemId);
      if (workspaceId) {
        navigate(routes.workspace(workspaceId));
      }
    }
  }

  return (
    <div className="contents" data-telemetry-block>
      <ProductSidebar
        showHeader
        title="Proliferate"
        headerAction={{
          id: "new-chat",
          label: "New chat",
          icon: <Plus className="size-3.5" />,
        }}
        navItems={navItems}
        workspaceGroups={workspaceGroups}
        workspaceSectionMessage={workspaceSectionMessage}
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

function buildNavItems(
  pathname: string,
  routeState: CloudSidebarRouteState,
): SidebarNavItemView[] {
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
      active: routeState.workspacesActive,
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

function buildWorkspaceGroups(input: {
  workspaces: readonly CloudSidebarWorkspace[];
  routeState: CloudSidebarRouteState;
  collapsedGroupIds: ReadonlySet<string>;
}): SidebarWorkspaceGroupView[] {
  return buildCloudSidebarWorkspaceGroups({
    workspaces: input.workspaces,
    route: input.routeState,
    collapsedGroupIds: input.collapsedGroupIds,
  }).map((group) => ({
    id: group.id,
    label: group.label,
    count: group.count,
    collapsed: group.collapsed,
    icon: <Cloud className="size-4" />,
    expandedIcon: <Cloud className="size-4" />,
    rows: group.workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      subtitle: workspace.subtitle,
      active: workspace.active,
      archived: workspace.archived,
      status: workspaceStatusIcon(workspace),
      detail: <WorkspaceDetailIndicators workspace={workspace} />,
      trailingLabel: workspace.trailingLabel,
      actions: workspace.lastSessionId
        ? [
          {
            id: "open-latest-session",
            label: "Open latest session",
            icon: <MessageSquare className="size-3.5" />,
          },
        ]
        : [],
    })),
    actions: [],
  }));
}

function buildChatRows(
  sessions: CloudSidebarSessionModel[],
): SidebarChatRowView[] {
  return sessions.map((session) => ({
    id: session.id,
    label: session.label,
    subtitle: session.subtitle,
    active: session.active,
    status: <MessageSquare className="size-3.5" />,
    detail: session.sourceAgentKind ? (
      <span
        className="rounded-sm border border-sidebar-border px-1 text-[10px] uppercase leading-4 text-sidebar-muted-foreground"
        title={`Agent: ${session.sourceAgentKind}`}
      >
        {session.sourceAgentKind.slice(0, 2)}
      </span>
    ) : null,
    trailingLabel: session.statusLabel,
    actions: [
      {
        id: "open-workspace",
        label: "Open workspace",
        icon: <Cloud className="size-3.5" />,
      },
    ],
  }));
}

function WorkspaceDetailIndicators({
  workspace,
}: {
  workspace: CloudSidebarWorkspaceModel;
}) {
  const labels = [
    workspace.visibilityLabel,
    workspace.exposureLabel,
    workspace.runtimeLabel,
  ].filter(Boolean);

  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      {workspace.exposureLabel === "Live" ? (
        <Radio className="size-3 text-success" aria-label="Live exposure" />
      ) : null}
      <Users className="size-3.5" aria-label={workspace.visibilityLabel} />
      <span
        className="max-w-[54px] truncate text-[10px] uppercase leading-4 text-sidebar-muted-foreground"
        title={labels.join(" - ")}
      >
        {workspace.visibilityLabel}
      </span>
    </div>
  );
}

function workspaceStatusIcon(workspace: CloudSidebarWorkspaceModel) {
  if (workspace.statusKind === "archived") {
    return (
      <CloudOff
        className="size-3.5 text-sidebar-muted-foreground"
        aria-label={workspace.statusLabel}
      />
    );
  }
  if (workspace.statusKind === "blocked") {
    return <span className="size-2 rounded-full bg-destructive" aria-label="Needs attention" />;
  }
  if (workspace.statusKind === "ready") {
    return <span className="size-2 rounded-full bg-success" aria-label="Ready" />;
  }
  return <span className="size-2 rounded-full bg-warning" aria-label={workspace.statusLabel} />;
}

function buildWorkspaceSectionMessage(input: {
  isLoading: boolean;
  hasError: boolean;
  hasWorkspaces: boolean;
}): SidebarSectionMessageView | null {
  if (input.hasWorkspaces) {
    return null;
  }
  if (input.isLoading) {
    return {
      title: "Loading cloud workspaces",
      description: "Fetching exposed and claimed workspaces for this account.",
      status: <LoaderCircle className="size-3.5 animate-spin" />,
    };
  }
  if (input.hasError) {
    return {
      title: "Could not load workspaces",
      description: "Refresh the page or sign in again.",
      tone: "danger",
      status: <CircleAlert className="size-3.5" />,
    };
  }
  return {
    title: "No cloud workspaces",
    description: "Create a workspace from Home or open a shared workspace link.",
  };
}
