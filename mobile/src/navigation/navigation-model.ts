import type { MobileIconName } from "../components/primitives/MobileIcon";

export type RouteId = "home" | "workspaces" | "sessions" | "automations" | "settings";

export interface DrawerRoute {
  id: RouteId;
  label: string;
  icon: MobileIconName;
}

export interface MobileCloudChat {
  workspaceId: string;
  workspaceName: string;
  repoLabel: string;
  branchLabel: string;
  targetId: string;
  workspaceRuntimeId: string | null;
  sessionId: string;
  title: string;
  status: string;
  visibility: string;
}

export const drawerRoutes: DrawerRoute[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "workspaces", label: "Workspaces", icon: "workspaces" },
  { id: "sessions", label: "Sessions", icon: "sessions" },
  { id: "automations", label: "Automations", icon: "calendar-clock" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function routeTitle(route: RouteId): string {
  return drawerRoutes.find((item) => item.id === route)?.label ?? "Home";
}
