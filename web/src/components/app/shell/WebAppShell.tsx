import { Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@proliferate/ui/layout/AppShell";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

import { WebSidebarController } from "../navigation/WebSidebarController";

export function WebAppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <AppShell
      sidebar={sidebarOpen ? <WebSidebarController onToggleSidebar={() => setSidebarOpen(false)} /> : null}
      data-proliferate-client="web"
      className="relative"
    >
      {!sidebarOpen ? (
        <div className="absolute left-3 top-3 z-30">
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
