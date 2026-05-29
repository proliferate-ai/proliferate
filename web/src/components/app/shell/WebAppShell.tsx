import { Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@proliferate/ui/layout/AppShell";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

import { WebSidebarController } from "../navigation/WebSidebarController";

const SIDEBAR_DOCKED_QUERY = "(min-width: 1024px)";

export function WebAppShell() {
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
      ) : null}
      data-proliferate-client="web"
      className="relative"
    >
      {!sidebarOpen ? (
        <div className="absolute bottom-3 left-3 z-30 md:bottom-auto md:top-3">
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
