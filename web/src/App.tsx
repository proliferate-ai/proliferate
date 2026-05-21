import { Navigate, Route } from "react-router-dom";

import { WebAppShell } from "./components/app/shell/WebAppShell";
import { AuthGate } from "./components/auth/AuthGate";
import { AuthScreen } from "./components/auth/screen/AuthScreen";
import { ConnectGitHubScreen } from "./components/auth/screen/ConnectGitHubScreen";
import { routes } from "./config/routes";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthErrorPage } from "./pages/AuthErrorPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { ChatPage } from "./pages/ChatPage";
import { DesktopHandoffPage } from "./pages/DesktopHandoffPage";
import { HomePage } from "./pages/HomePage";
import { PluginsPage } from "./pages/PluginsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SupportPage } from "./pages/SupportPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { InstrumentedRoutes } from "./lib/integrations/telemetry/sentry";

export function App() {
  return (
    <InstrumentedRoutes>
      <Route path="auth" element={<AuthScreen />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="auth/desktop/handoff" element={<DesktopHandoffPage />} />
      <Route path="auth/error" element={<AuthErrorPage />} />
      <Route path="connect-github" element={<ConnectGitHubScreen />} />
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
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workspaces/:workspaceId" element={<ChatPage />} />
        <Route path="workspaces/:workspaceId/chats/:chatId" element={<ChatPage />} />
        <Route path="cloud/workspaces/:workspaceId" element={<ChatPage />} />
        <Route path="cloud/workspaces/:workspaceId/chats/:chatId" element={<ChatPage />} />
        <Route path="*" element={<Navigate to={routes.home} replace />} />
      </Route>
    </InstrumentedRoutes>
  );
}
