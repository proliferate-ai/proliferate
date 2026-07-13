import { useEffect, useRef, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { DesktopWorkspaceDeepLinkPage } from "@/pages/DesktopWorkspaceDeepLinkPage";
import { MainPage } from "@/pages/MainPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";
import { useOrganizationSelectionLifecycle } from "@/hooks/organizations/lifecycle/use-organization-selection-lifecycle";

type MainRouteComponent = ComponentType<{ workspaceVisible?: boolean }>;
type SettingsRouteComponent = ComponentType<{ returnTo?: string }>;

interface AuthenticatedAppHostProps {
  MainComponent?: MainRouteComponent;
  SettingsComponent?: SettingsRouteComponent;
}

export function AuthenticatedAppHost({
  MainComponent = MainPage,
  SettingsComponent = SettingsPage,
}: AuthenticatedAppHostProps = {}) {
  useOrganizationSelectionLifecycle();
  const location = useLocation();
  const isSettingsRoute = location.pathname === APP_ROUTES.settings;
  const lastNonSettingsHrefRef = useRef<string>(APP_ROUTES.home);

  useEffect(() => {
    if (isSettingsRoute) {
      return;
    }
    lastNonSettingsHrefRef.current = `${location.pathname}${location.search}${location.hash}`;
  }, [isSettingsRoute, location.hash, location.pathname, location.search]);

  const isHomeRoute = location.pathname === APP_ROUTES.home;
  // The workspace shell stays mounted (hidden) across every authenticated
  // route: cold-mounting it on return from /workflows or /workspaces is
  // seconds of synchronous hydration work.
  const workspaceHostClassName = isSettingsRoute
    ? "pointer-events-none"
    : isHomeRoute
      ? undefined
      : "hidden";

  return (
    <>
      <div
        aria-hidden={isHomeRoute ? undefined : "true"}
        className={workspaceHostClassName}
      >
        <MainComponent workspaceVisible={isHomeRoute} />
      </div>

      {isSettingsRoute ? (
        <div className="fixed inset-0 z-50 bg-surface-under">
          <SettingsComponent returnTo={lastNonSettingsHrefRef.current} />
        </div>
      ) : isHomeRoute ? null : (
        <Routes>
          <Route path="setup" element={<Navigate to={APP_ROUTES.home} replace />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="workflows/:workflowId" element={<WorkflowsPage />} />
          <Route path="automations" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} />} />
          <Route path="automations/:workflowId" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<DesktopWorkspaceDeepLinkPage />} />
          <Route path="*" element={<Navigate to={APP_ROUTES.home} replace />} />
        </Routes>
      )}
    </>
  );
}

function LegacyRouteRedirect({
  to,
}: {
  to: string;
}) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}
