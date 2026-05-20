import { Outlet } from "react-router-dom";

import { AppShell } from "@proliferate/ui/layout/AppShell";

import { WebSidebarController } from "../navigation/WebSidebarController";

export function WebAppShell() {
  return (
    <AppShell sidebar={<WebSidebarController />} data-proliferate-client="web">
      <Outlet />
    </AppShell>
  );
}
