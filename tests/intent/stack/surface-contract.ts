export const BROWSER_SURFACE_LANES = ["desktop-web", "hosted-web"] as const;

export type BrowserSurfaceLane = (typeof BROWSER_SURFACE_LANES)[number];

export interface SurfacePrincipal {
  userId: string;
  email: string;
  organizationId: string;
}

export interface SurfaceIdentityObservation {
  lane: BrowserSurfaceLane;
  clientId: "desktop" | "web";
  principalEmail: string;
  organizationId: string;
  pathname: string;
}

export function browserSurfaceLane(projectName: string): BrowserSurfaceLane {
  if (projectName === "desktop-web" || projectName === "hosted-web") {
    return projectName;
  }
  throw new Error(`Project ${projectName} is not a browser surface lane`);
}

export function surfaceBaseUrl(lane: BrowserSurfaceLane): string {
  const variable = lane === "desktop-web"
    ? "TIER2_INTENT_DESKTOP_WEB_BASE_URL"
    : "TIER2_INTENT_HOSTED_WEB_BASE_URL";
  const value = process.env[variable];
  if (!value) {
    throw new Error(`${variable} is not set — did surfaces-global-setup run?`);
  }
  return value;
}

export function expectedClientId(lane: BrowserSurfaceLane): "desktop" | "web" {
  return lane === "desktop-web" ? "desktop" : "web";
}
