import { APP_ROUTES } from "#product/config/app-routes";

export function isWorkspaceProviderRoute(pathname: string): boolean {
  return pathname === APP_ROUTES.home || pathname === APP_ROUTES.settings;
}

export function resolveRouteScopedWorkspaceProviderId(args: {
  pathname: string;
  selectedLogicalWorkspaceId: string | null | undefined;
  selectedWorkspaceId: string | null | undefined;
}): string | null {
  if (!isWorkspaceProviderRoute(args.pathname)) {
    return null;
  }

  return args.selectedLogicalWorkspaceId ?? args.selectedWorkspaceId ?? null;
}
