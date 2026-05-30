import { Navigate, Route, useLocation, type Location } from "react-router-dom";

import { WebAppShell } from "./components/app/shell/WebAppShell";
import { AuthGate } from "./components/auth/AuthGate";
import { AuthScreen } from "./components/auth/screen/AuthScreen";
import { ConnectGitHubScreen } from "./components/auth/screen/ConnectGitHubScreen";
import { routes } from "./config/routes";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthErrorPage } from "./pages/AuthErrorPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { BillingReturnHandoffPage } from "./pages/BillingReturnHandoffPage";
import { ChatPage } from "./pages/ChatPage";
import { DesktopHandoffPage } from "./pages/DesktopHandoffPage";
import { HomePage } from "./pages/HomePage";
import { PluginConnectCompletePage } from "./pages/PluginConnectCompletePage";
import { PluginsPage } from "./pages/PluginsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsModalPage } from "./pages/SettingsModalPage";
import { SupportPage } from "./pages/SupportPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { InstrumentedRoutes } from "./lib/integrations/telemetry/sentry";

export function App() {
  const location = useLocation();
  const routeState = location.state as { backgroundLocation?: Location } | null;
  const backgroundLocation = isSettingsPath(location.pathname)
    ? routeState?.backgroundLocation ?? null
    : null;

  return (
    <>
      <InstrumentedRoutes location={backgroundLocation ?? location}>
        <Route path="auth" element={<AuthScreen />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route path="auth/desktop/handoff" element={<DesktopHandoffPage />} />
        <Route path="auth/error" element={<AuthErrorPage />} />
        <Route path="connect-github" element={<ConnectGitHubScreen />} />
        <Route path="settings/cloud" element={<BillingReturnHandoffPage />} />
        <Route path="plugins/connect/complete" element={<PluginConnectCompletePage />} />
        <Route
          element={
            <AuthGate>
              <WebAppShell />
            </AuthGate>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/:automationId" element={<AutomationsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:sectionId" element={<SettingsPage />} />
          <Route path="workspaces/:workspaceId" element={<ChatPage />} />
          <Route path="workspaces/:workspaceId/chats/:chatId" element={<ChatPage />} />
          <Route path="cloud/workspaces/:workspaceId" element={<ChatPage />} />
          <Route path="cloud/workspaces/:workspaceId/chats/:chatId" element={<ChatPage />} />
          <Route path="*" element={<Navigate to={routes.home} replace />} />
        </Route>
      </InstrumentedRoutes>
      {backgroundLocation ? (
        <InstrumentedRoutes>
          <Route
            path="settings"
            element={
              <AuthGate>
                <SettingsModalPage />
              </AuthGate>
            }
          />
          <Route
            path="settings/:sectionId"
            element={
              <AuthGate>
                <SettingsModalPage />
              </AuthGate>
            }
          />
        </InstrumentedRoutes>
      ) : null}
    </>
  );
}

function isSettingsPath(pathname: string): boolean {
  return pathname === routes.settings || pathname.startsWith(`${routes.settings}/`);
}
