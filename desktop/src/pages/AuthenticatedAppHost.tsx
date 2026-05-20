import { useEffect, useRef, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { APP_ROUTES, LEGACY_APP_ROUTES } from "@/config/app-routes";
import { AutomationDetailPage } from "@/pages/AutomationDetailPage";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { MainPage } from "@/pages/MainPage";
import { PluginsPage } from "@/pages/PluginsPage";
import { SettingsPage } from "@/pages/SettingsPage";

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
            element={<Navigate to={APP_ROUTES.plugins} replace />}
          />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/:automationId" element={<AutomationDetailPage />} />
          <Route path="*" element={<Navigate to={APP_ROUTES.home} replace />} />
        </Routes>
      )}
    </>
  );
}
