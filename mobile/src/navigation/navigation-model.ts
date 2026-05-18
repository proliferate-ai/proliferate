export type RouteId = "home" | "workspaces" | "sessions" | "automations" | "settings";

export interface DrawerRoute {
  id: RouteId;
  label: string;
  glyph: string;
}

export const drawerRoutes: DrawerRoute[] = [
  { id: "home", label: "Home", glyph: "H" },
  { id: "workspaces", label: "Workspaces", glyph: "W" },
  { id: "sessions", label: "Sessions", glyph: "S" },
  { id: "automations", label: "Automations", glyph: "A" },
  { id: "settings", label: "Settings", glyph: "G" },
];

export function routeTitle(route: RouteId): string {
  return drawerRoutes.find((item) => item.id === route)?.label ?? "Home";
}
