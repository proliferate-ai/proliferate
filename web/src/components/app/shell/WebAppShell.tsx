import { Outlet } from "react-router-dom";

import { AppSidebar } from "../navigation/AppSidebar";

export function WebAppShell() {
  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <AppSidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
