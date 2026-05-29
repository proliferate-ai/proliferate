import {
  Blocks,
  CalendarClock,
  Cloud,
  House,
  LifeBuoy,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { AppShell } from "@proliferate/ui/layout/AppShell";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

import { routes } from "../../../config/routes";
import { WebSidebarController } from "../navigation/WebSidebarController";

const SIDEBAR_DOCKED_QUERY = "(min-width: 1024px)";

export function WebAppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window === "undefined" || !window.matchMedia
      ? true
      : window.matchMedia(SIDEBAR_DOCKED_QUERY).matches
  ));
  const [sidebarRendered, setSidebarRendered] = useState(sidebarOpen);
  const [sidebarVisible, setSidebarVisible] = useState(sidebarOpen);

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }
    const query = window.matchMedia(SIDEBAR_DOCKED_QUERY);
    const handleChange = () => {
      if (!query.matches) {
        setSidebarOpen(false);
      }
    };
    if (query.addEventListener) {
      query.addEventListener("change", handleChange);
      return () => query.removeEventListener("change", handleChange);
    }
    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) {
      setSidebarVisible(false);
      setSidebarRendered(false);
      return;
    }

    setSidebarRendered(true);
    const frame = window.requestAnimationFrame(() => setSidebarVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarOpen]);

  return (
    <AppShell
      sidebar={sidebarRendered ? (
        <>
          <button
            type="button"
            aria-label="Close sidebar"
            className={`fixed inset-0 z-40 bg-background/55 backdrop-blur-[1px] transition-opacity duration-200 ease-out lg:hidden ${
              sidebarVisible ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setSidebarOpen(false)}
          />
          <div
            className={`fixed inset-y-0 left-0 z-50 transform-gpu transition-transform duration-200 ease-out lg:static lg:inset-auto lg:z-auto lg:h-full lg:transform-none lg:transition-none ${
              sidebarVisible ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <WebSidebarController onToggleSidebar={() => setSidebarOpen(false)} />
          </div>
        </>
      ) : (
        <CollapsedSidebarRail
          pathname={location.pathname}
          onOpenSidebar={() => setSidebarOpen(true)}
          onNavigate={(path) => navigate(path)}
          onOpenSettings={() => {
            navigate(routes.settings, {
              state: { backgroundLocation: location },
            });
          }}
        />
      )}
      data-proliferate-client="web"
      className="relative"
    >
      {!sidebarOpen ? (
        <div className="absolute bottom-3 left-3 z-30 sm:hidden">
          <IconButton
            tone="default"
            size="sm"
            title="Show sidebar"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md border border-border/70 bg-background/90 shadow-sm backdrop-blur"
          >
            <PanelLeftOpen className="size-4" />
          </IconButton>
        </div>
      ) : null}
      <Outlet />
    </AppShell>
  );
}

interface CollapsedSidebarRailProps {
  pathname: string;
  onOpenSidebar: () => void;
  onNavigate: (path: string) => void;
  onOpenSettings: () => void;
}

function CollapsedSidebarRail({
  pathname,
  onOpenSidebar,
  onNavigate,
  onOpenSettings,
}: CollapsedSidebarRailProps) {
  const items: readonly CollapsedRailItem[] = [
    {
      id: "home",
      label: "Home",
      icon: <House className="size-4" />,
      active: pathname === routes.home,
      onSelect: () => onNavigate(routes.home),
    },
    {
      id: "workspaces",
      label: "Workspaces",
      icon: <Cloud className="size-4" />,
      active: pathname === routes.workspaces ||
        pathname.startsWith("/cloud/workspaces"),
      onSelect: () => onNavigate(routes.workspaces),
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <Blocks className="size-4" />,
      active: pathname.startsWith(routes.plugins),
      onSelect: () => onNavigate(routes.plugins),
    },
    {
      id: "automations",
      label: "Automations",
      icon: <CalendarClock className="size-4" />,
      active: pathname.startsWith(routes.automations),
      onSelect: () => onNavigate(routes.automations),
    },
    {
      id: "support",
      label: "Support",
      icon: <LifeBuoy className="size-4" />,
      active: pathname.startsWith(routes.support),
      onSelect: () => onNavigate(routes.support),
    },
  ];

  return (
    <aside
      aria-label="Collapsed sidebar"
      className="hidden h-full w-12 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-1.5 py-2 text-sidebar-foreground sm:flex"
    >
      <IconButton
        tone="sidebar"
        size="sm"
        title="Open sidebar"
        onClick={onOpenSidebar}
        className="size-9 rounded-lg"
      >
        <PanelLeftOpen className="size-4" />
      </IconButton>

      <nav className="mt-3 flex flex-col items-center gap-1" aria-label="Primary">
        {items.map((item) => (
          <RailIconButton key={item.id} item={item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center">
        <IconButton
          tone="sidebar"
          size="sm"
          title="Settings"
          onClick={onOpenSettings}
          className={`size-9 rounded-lg ${
            pathname.startsWith(routes.settings)
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : ""
          }`}
        >
          <Settings className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}

interface CollapsedRailItem {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
}

function RailIconButton({ item }: { item: CollapsedRailItem }) {
  return (
    <IconButton
      tone="sidebar"
      size="sm"
      title={item.label}
      onClick={item.onSelect}
      aria-current={item.active ? "page" : undefined}
      className={`size-9 rounded-lg ${
        item.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
      }`}
    >
      {item.icon}
    </IconButton>
  );
}
