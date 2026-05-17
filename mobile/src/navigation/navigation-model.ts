export type RouteId = "home" | "sessions" | "automations" | "settings";

export interface DrawerRoute {
  id: RouteId;
  label: string;
  glyph: string;
}

export const drawerRoutes: DrawerRoute[] = [
  { id: "home", label: "Home", glyph: "H" },
  { id: "sessions", label: "Sessions", glyph: "S" },
  { id: "automations", label: "Automations", glyph: "A" },
  { id: "settings", label: "Settings", glyph: "G" },
];

export function routeTitle(route: RouteId): string {
  return drawerRoutes.find((item) => item.id === route)?.label ?? "Home";
}
