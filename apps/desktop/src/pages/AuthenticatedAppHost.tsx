import { useEffect, useRef, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { APP_ROUTES, LEGACY_APP_ROUTES } from "@/config/app-routes";
import { DesktopWorkspaceDeepLinkPage } from "@/pages/DesktopWorkspaceDeepLinkPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { MainPage } from "@/pages/MainPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { useOrganizationSelectionLifecycle } from "@/hooks/organizations/lifecycle/use-organization-selection-lifecycle";

type MainRouteComponent = ComponentType<{ workspaceVisible?: boolean }>;
type SettingsRouteComponent = ComponentType<{ returnTo?: string }>;
const LEGACY_POWERS_ROUTE = LEGACY_APP_ROUTES.powers.replace(/^\//u, "");

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
  const shouldRenderWorkspace = isHomeRoute || isSettingsRoute;
  const workspaceHostClassName = isSettingsRoute
    ? "pointer-events-none"
    : shouldRenderWorkspace
      ? undefined
      : "hidden";

  return (
    <>
      <div
        aria-hidden={isSettingsRoute ? "true" : undefined}
        className={workspaceHostClassName}
      >
        {shouldRenderWorkspace && <MainComponent workspaceVisible={!isSettingsRoute} />}
      </div>

      {isSettingsRoute ? (
        <div className="fixed inset-0 z-50 bg-surface-under">
          <SettingsComponent returnTo={lastNonSettingsHrefRef.current} />
        </div>
      ) : isHomeRoute ? null : (
        <Routes>
          <Route path="setup" element={<Navigate to={APP_ROUTES.home} replace />} />
          <Route
            path={LEGACY_POWERS_ROUTE}
            element={<LegacyRouteRedirect to={APP_ROUTES.integrations} />}
          />
          <Route path="plugins" element={<LegacyRouteRedirect to={APP_ROUTES.integrations} />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="workflows/:workflowId" element={<WorkflowsPage />} />
          <Route path="automations" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} />} />
          <Route path="automations/:workflowId" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} extractLastSegment />} />
          <Route path="workspaces" element={<Navigate to={APP_ROUTES.home} replace />} />
          <Route path="workspaces/:workspaceId" element={<DesktopWorkspaceDeepLinkPage />} />
          <Route path="*" element={<Navigate to={APP_ROUTES.home} replace />} />
        </Routes>
      )}
    </>
  );
}

function LegacyRouteRedirect({
  to,
  extractLastSegment = false,
}: {
  to: string;
  extractLastSegment?: boolean;
}) {
  const location = useLocation();
  const segments = extractLastSegment ? location.pathname.split("/").filter(Boolean) : [];
  const match = extractLastSegment ? segments[segments.length - 1] ?? null : null;
  const suffix = match ? `/${encodeURIComponent(decodeURIComponent(match))}` : "";
  return <Navigate to={`${to}${suffix}${location.search}${location.hash}`} replace />;
}
