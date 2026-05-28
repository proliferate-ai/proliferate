import {
  Blocks,
  CalendarClock,
  Check,
  CircleAlert,
  Cloud,
  House,
  Hash,
  LifeBuoy,
  ListFilter,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Settings,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  useCloudWorkspaceSnapshot,
  useVisibleCloudWorkspaces,
} from "@proliferate/cloud-sdk-react";
import {
  buildRecentWorkItems,
  type RecentWorkItemView,
  type RecentWorkRuntimeLocation,
  type RecentWorkSourceKind,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";
import { PopoverMenuItem } from "@proliferate/product-ui/popover/PopoverMenuItem";
import type {
  SidebarActionEvent,
  SidebarNavItemView,
  SidebarSectionMessageView,
  SidebarWorkspaceGroupView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import {
  ProductSidebar,
  SidebarActionButton,
} from "@proliferate/product-ui/sidebar/ProductSidebar";

import { routes } from "../../../config/routes";
import {
  mergeCloudSidebarWorkspaces,
  parseCloudSidebarRoute,
  type CloudSidebarRouteState,
} from "../../../lib/domain/sidebar/cloud-sidebar-model";

const EMPTY_ACTIVE_WORKSPACE_SESSIONS = [] as const;
const RECENT_ROW_LIMIT = 16;

type SourceFilter = RecentWorkSourceKind | "all";
type RuntimeFilter = RecentWorkRuntimeLocation | "all";

const SOURCE_FILTERS: readonly { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "desktop_exposed", label: "Desktop" },
  { id: "cloud_sandbox", label: "Cloud sandbox" },
  { id: "web", label: "Web" },
  { id: "mobile", label: "Mobile" },
  { id: "personal_automation", label: "Personal automation" },
  { id: "team_automation", label: "Team automation" },
  { id: "slack", label: "Slack" },
  { id: "api", label: "API" },
];

const RUNTIME_FILTERS: readonly { id: RuntimeFilter; label: string }[] = [
  { id: "all", label: "All runtimes" },
  { id: "local_desktop", label: "Local Desktop" },
  { id: "cloud_sandbox", label: "Cloud runtime" },
  { id: "ssh_remote", label: "SSH remote" },
  { id: "offline", label: "Offline" },
  { id: "unknown", label: "Unknown" },
];

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
  const recentItems = useMemo(
    () => buildRecentWorkItems(cloudWorkspaces, {
      activeWorkspaceSessions,
      nowMs: Date.now(),
    }),
    [activeWorkspaceSessions, cloudWorkspaces],
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
      navigate(routes.settings, {
        state: { backgroundLocation: location },
      });
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
    if (event.scope === "workspace" && event.actionId === "open-workspace" && event.itemId) {
      const item = recentItemByRowId.get(event.itemId);
      if (item) {
        navigate(routes.workspace(item.workspaceId));
      }
      return;
    }
    if (event.scope === "chat" && event.actionId === "open-workspace" && event.itemId) {
      const item = recentItems.find((candidate) => candidate.sessionId === event.itemId);
      if (item) {
        navigate(routes.workspace(item.workspaceId));
      }
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

function buildRecentWorkspaceGroups(input: {
  items: readonly RecentWorkItemView[];
  routeState: CloudSidebarRouteState;
}): SidebarWorkspaceGroupView[] {
  return [{
    id: "recents",
    label: "Recent work",
    count: input.items.length,
    collapsed: false,
    icon: <MessageSquare className="size-4" />,
    expandedIcon: <MessageSquare className="size-4" />,
    rows: input.items.map((item) => ({
      id: item.id,
      label: recentRowTitle(item),
      subtitle: null,
      active: recentRowIsActive(item, input.routeState),
      archived: item.state === "done",
      status: <RecentSourceIndicator item={item} />,
      detail: null,
      trailingLabel: item.lastActivityLabel,
      actions: item.rowKind === "session"
        ? [{
          id: "open-workspace",
          label: "Open workspace",
          icon: <Cloud className="size-3.5" />,
        }]
        : [],
    })),
    actions: [],
  }];
}

function recentRowTitle(item: RecentWorkItemView): string {
  if (item.rowKind !== "session") {
    return item.title;
  }
  return cleanRecentSessionTitle(item.title) ?? "Chat session";
}

function cleanRecentSessionTitle(title: string | null | undefined): string | null {
  const value = title?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "invalid input"
    || normalized === "unclear input"
    || normalized === "stray keystroke"
    || normalized === "single character input"
  ) {
    return null;
  }
  return value;
}

function recentRowIsActive(
  item: RecentWorkItemView,
  route: CloudSidebarRouteState,
): boolean {
  if (item.rowKind === "session") {
    return route.workspaceId === item.workspaceId && route.sessionId === item.sessionId;
  }
  return route.workspaceId === item.workspaceId && !route.sessionId;
}

function RecentSourceIndicator({ item }: { item: RecentWorkItemView }) {
  const icon = sourceIcon(item.sourceKind);
  return (
    <span
      className="flex size-4 items-center justify-center text-sidebar-muted-foreground"
      title={sourceIndicatorLabel(item)}
      aria-label={sourceIndicatorLabel(item)}
    >
      {icon}
    </span>
  );
}

function sourceIcon(source: RecentWorkSourceKind): ReactNode {
  switch (source) {
    case "mobile":
      return <Smartphone className="size-3.5" />;
    case "slack":
      return <Hash className="size-3.5" />;
    case "personal_automation":
    case "team_automation":
      return <CalendarClock className="size-3.5" />;
    case "desktop_exposed":
    case "cloud_sandbox":
    case "web":
    case "api":
    case "unknown":
      return <Cloud className="size-3.5" />;
  }
}

function sourceIndicatorLabel(item: RecentWorkItemView): string {
  switch (item.sourceKind) {
    case "mobile":
      return "Mobile dispatch";
    case "web":
      return item.ownership === "unclaimed"
        ? "Cloud workspace, unclaimed"
        : "Cloud workspace";
    case "slack":
      return "Slack";
    case "personal_automation":
    case "team_automation":
      return "Automation";
    case "desktop_exposed":
    case "cloud_sandbox":
    case "api":
    case "unknown":
      return item.ownership === "unclaimed"
        ? "Cloud workspace, unclaimed"
        : "Cloud workspace";
  }
}

function RecentFilterPopover({
  open,
  activeFilterCount,
  onToggle,
  onClose,
  sourceFilter,
  runtimeFilter,
  onSourceFilterChange,
  onRuntimeFilterChange,
  onClear,
  onOpenAll,
}: {
  open: boolean;
  activeFilterCount: number;
  onToggle: () => void;
  onClose: () => void;
  sourceFilter: SourceFilter;
  runtimeFilter: RuntimeFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  onRuntimeFilterChange: (filter: RuntimeFilter) => void;
  onClear: () => void;
  onOpenAll: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div ref={rootRef} className="relative">
      <SidebarActionButton
        title="Filter recents"
        active={open || activeFilterCount > 0}
        variant="section"
        onClick={onToggle}
      >
        <ListFilter className="size-3" />
        {activeFilterCount ? (
          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-sidebar-foreground" />
        ) : null}
      </SidebarActionButton>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-[min(28rem,calc(100vh-12rem))] w-56 overflow-y-auto rounded-xl bg-popover/95 p-1 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm">
          <FilterMenuSection label="Source">
            {SOURCE_FILTERS.map((option) => (
              <FilterMenuOption
                key={option.id}
                active={sourceFilter === option.id}
                label={option.label}
                onClick={() => onSourceFilterChange(option.id)}
              />
            ))}
          </FilterMenuSection>
          <div className="my-1 h-px bg-border" />
          <FilterMenuSection label="Runtime">
            {RUNTIME_FILTERS.map((option) => (
              <FilterMenuOption
                key={option.id}
                active={runtimeFilter === option.id}
                label={option.label}
                onClick={() => onRuntimeFilterChange(option.id)}
              />
            ))}
          </FilterMenuSection>
          <div className="my-1 h-px bg-border" />
          <PopoverMenuItem
            variant="sidebar"
            label="Clear filters"
            disabled={activeFilterCount === 0}
            onClick={onClear}
          />
          <PopoverMenuItem
            variant="sidebar"
            label="Open workspaces"
            onClick={onOpenAll}
          />
        </div>
      ) : null}
    </div>
  );
}

function FilterMenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase leading-3 text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  );
}

function FilterMenuOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <PopoverMenuItem
      aria-pressed={active}
      onClick={onClick}
      variant="sidebar"
      label={label}
      trailing={active ? <Check className="size-3.5 text-foreground/60" /> : null}
      className={active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}
    />
  );
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
