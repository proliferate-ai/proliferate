import type { MobileIconName } from "../components/primitives/MobileIcon";

export type RouteId = "home" | "work" | "automations" | "settings";

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
  targetId: string | null;
  workspaceRuntimeId: string | null;
  sessionId: string | null;
  title: string;
  status: string;
  visibility: string;
  initialPendingPrompt?: MobilePendingPrompt | null;
}

export interface MobilePendingPrompt {
  id: string;
  text: string;
  agentKind?: string | null;
  modelId: string | null;
  modeId: string | null;
  sessionConfigUpdates?: { configId: string; value: string }[];
  selectedRepo?: string | null;
  selectedRuntimeTargetId?: string | null;
  createdAt: number;
  dispatchedSessionId?: string | null;
  sendCommandId?: string | null;
  failedAt?: number | null;
  failureMessage?: string | null;
}

export const drawerRoutes: DrawerRoute[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "automations", label: "Automations", icon: "calendar-clock" },
  { id: "work", label: "Workspaces", icon: "workspaces" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const allWorkRoute: DrawerRoute = { id: "work", label: "Workspaces", icon: "workspaces" };

export function routeTitle(route: RouteId): string {
  if (route === allWorkRoute.id) {
    return allWorkRoute.label;
  }
  return drawerRoutes.find((item) => item.id === route)?.label ?? "Home";
}
