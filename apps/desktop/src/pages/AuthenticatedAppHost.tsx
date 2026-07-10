import { useEffect, useRef, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { DesktopWorkspaceDeepLinkPage } from "@/pages/DesktopWorkspaceDeepLinkPage";
import { MainPage } from "@/pages/MainPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkflowsHomePage } from "@/pages/WorkflowsHomePage";
import { WorkflowEditorPage } from "@/pages/WorkflowEditorPage";
import { WorkflowRunPage } from "@/pages/WorkflowRunPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";
import { useOrganizationSelectionLifecycle } from "@/hooks/organizations/lifecycle/use-organization-selection-lifecycle";
import { useWorkflowsEnabled } from "@/hooks/access/cloud/use-server-features";

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
  const workflowsEnabled = useWorkflowsEnabled();
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
          {/* D-003 launch flag: workflows routes exist only when the server
              advertises the surface; a held deployment falls through to the
              home redirect below (the API 404s regardless). */}
          {workflowsEnabled ? (
            <>
              <Route path="workflows" element={<WorkflowsHomePage />} />
              <Route path="workflows/:workflowId" element={<WorkflowEditorPage />} />
              <Route path="workflows/:workflowId/edit" element={<WorkflowEditorPage />} />
              <Route path="workflows/:workflowId/runs/:runId" element={<WorkflowRunPage />} />
              <Route path="automations" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} />} />
              <Route path="automations/:workflowId" element={<LegacyRouteRedirect to={APP_ROUTES.workflows} extractLastSegment />} />
            </>
          ) : null}
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
