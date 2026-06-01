import {
  CircleAlert,
  PanelLeftClose,
  Plus,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  useCloudWorkspaceSnapshot,
  useVisibleCloudWorkspaces,
} from "@proliferate/cloud-sdk-react";
import {
  buildRecentWorkItems,
  type RecentWorkItemView,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import type {
  SidebarActionEvent,
  SidebarSectionMessageView,
} from "@proliferate/product-ui/sidebar/ProductSidebarModel";
import { ProductSidebar } from "@proliferate/product-ui/sidebar/ProductSidebar";

import { routes } from "../../../config/routes";
import {
  mergeCloudSidebarWorkspaces,
  parseCloudSidebarRoute,
} from "../../../lib/domain/sidebar/cloud-sidebar-model";
import {
  RecentFilterPopover,
  type RuntimeFilter,
  type SourceFilter,
} from "./WebSidebarFilters";
import { SidebarLoadingState } from "./WebSidebarLoadingState";
import { buildNavItems } from "./WebSidebarNavItems";
import { buildRecentWorkspaceGroups } from "./WebSidebarRecents";

const EMPTY_ACTIVE_WORKSPACE_SESSIONS = [] as const;
const RECENT_ROW_LIMIT = 16;

export function WebSidebarController({
  onToggleSidebar,
}: {
  onToggleSidebar?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");
  const [recentFilterOpen, setRecentFilterOpen] = useState(false);
  const routeState = useMemo(
    () => parseCloudSidebarRoute(location.pathname),
    [location.pathname],
  );
  const workspaces = useVisibleCloudWorkspaces();
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
  const workspaceSectionLoading = (workspaces.isLoading || activeWorkspaceSnapshot.isLoading) &&
    cloudWorkspaces.length === 0;
  const workspaceSectionMessage = useMemo(
    () => buildWorkspaceSectionMessage({
      hasError: Boolean(workspaces.error) && cloudWorkspaces.length === 0,
      hasWorkspaces: cloudWorkspaces.length > 0,
    }),
    [
      cloudWorkspaces.length,
      workspaces.error,
    ],
  );
  const recentItems = useMemo(
    () => buildRecentWorkItems(cloudWorkspaces, {
      activeWorkspaceId: routeState.sessionId ? null : routeState.workspaceId,
      activeWorkspaceSessions,
      nowMs: Date.now(),
    }),
    [activeWorkspaceSessions, cloudWorkspaces, routeState.sessionId, routeState.workspaceId],
  );
  const visibleRecentItems = useMemo(
    () => recentItems.filter((item) =>
      (sourceFilter === "all" || item.sourceKind === sourceFilter) &&
      (runtimeFilter === "all" || item.runtimeLocation === runtimeFilter)
    ).slice(0, RECENT_ROW_LIMIT),
    [recentItems, runtimeFilter, sourceFilter],
  );
  const workspaceGroups = useMemo(
    () => buildRecentWorkspaceGroups({
      items: visibleRecentItems,
      routeState,
    }),
    [routeState, visibleRecentItems],
  );
  const recentItemByRowId = useMemo(() => {
    const lookup = new Map<string, RecentWorkItemView>();
    for (const item of recentItems) {
      lookup.set(item.id, item);
    }
    return lookup;
  }, [recentItems]);
  const latestSessionByWorkspaceId = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const item of recentItems) {
      if (item.rowKind === "session" && item.sessionId) {
        lookup.set(item.workspaceId, item.sessionId);
      }
    }
    for (const workspace of cloudWorkspaces) {
      const sessionId = workspace.lastSessionSummary?.sessionId;
      if (sessionId && !lookup.has(workspace.id)) {
        lookup.set(workspace.id, sessionId);
      }
    }
    return lookup;
  }, [cloudWorkspaces, recentItems]);
  const activeFilterCount = [
    sourceFilter !== "all",
    runtimeFilter !== "all",
  ].filter(Boolean).length;
  const filterAction = (
    <RecentFilterPopover
      open={recentFilterOpen}
      activeFilterCount={activeFilterCount}
      onToggle={() => setRecentFilterOpen((open) => !open)}
      onClose={() => setRecentFilterOpen(false)}
      sourceFilter={sourceFilter}
      runtimeFilter={runtimeFilter}
      onSourceFilterChange={setSourceFilter}
      onRuntimeFilterChange={setRuntimeFilter}
      onClear={() => {
        setSourceFilter("all");
        setRuntimeFilter("all");
      }}
      onOpenAll={() => {
        setRecentFilterOpen(false);
        navigate(routes.workspaces);
      }}
    />
  );

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

  function handleWorkspaceSelect(rowId: string) {
    const item = recentItemByRowId.get(rowId);
    if (!item) {
      const sessionId = latestSessionByWorkspaceId.get(rowId);
      navigate(sessionId ? routes.chat(rowId, sessionId) : routes.workspace(rowId));
      return;
    }
    switch (item.openTarget.kind) {
      case "session":
        navigate(routes.chat(item.openTarget.workspaceId, item.openTarget.sessionId));
        return;
      case "workspace": {
        const sessionId = latestSessionByWorkspaceId.get(item.openTarget.workspaceId);
        navigate(
          sessionId
            ? routes.chat(item.openTarget.workspaceId, sessionId)
            : routes.workspace(item.openTarget.workspaceId),
        );
        return;
      }
      case "pending-session":
        navigate(routes.workspace(item.openTarget.workspaceId));
        return;
    }
  }

  function handleChatSelect(sessionId: string) {
    const sessionItem = recentItems.find((item) => item.sessionId === sessionId);
    if (sessionItem?.sessionId) {
      navigate(routes.chat(sessionItem.workspaceId, sessionItem.sessionId));
    }
  }

  function handleGroupToggle(_groupId: string) {
    return;
  }

  function handleAction(event: SidebarActionEvent) {
    if (event.scope === "header" && event.actionId === "new-chat") {
      navigate(routes.home);
      return;
    }
    if (event.scope === "header" && event.actionId === "toggle-sidebar") {
      onToggleSidebar?.();
      return;
    }
    if (event.scope === "footer" && event.actionId === "settings") {
      onToggleSidebar?.();
      navigate(routes.settings, {
        state: { backgroundLocation: location },
      });
    }
  }

  return (
    <div className="contents" data-telemetry-block>
      <ProductSidebar
        showHeader
        title="Proliferate"
        headerLeadingAction={onToggleSidebar ? {
          id: "toggle-sidebar",
          label: "Hide sidebar",
          icon: <PanelLeftClose className="size-3.5" />,
        } : null}
        headerAction={{
          id: "new-chat",
          label: "New chat",
          icon: <Plus className="size-3.5" />,
        }}
        navItems={navItems}
        workspaceGroups={workspaceGroups}
        workspaceSectionLabel="Recents"
        workspaceSectionActions={filterAction}
        workspaceSectionPanel={workspaceSectionLoading ? <SidebarLoadingState /> : null}
        workspaceSectionMessage={workspaceSectionMessage}
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

function buildWorkspaceSectionMessage(input: {
  hasError: boolean;
  hasWorkspaces: boolean;
}): SidebarSectionMessageView | null {
  if (input.hasWorkspaces) {
    return null;
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
