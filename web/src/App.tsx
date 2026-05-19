import { Navigate, Route, Routes } from "react-router-dom";

import { WebAppShell } from "./components/app/shell/WebAppShell";
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

export function App() {
  return (
    <Routes>
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="auth/desktop/handoff" element={<DesktopHandoffPage />} />
      <Route path="auth/error" element={<AuthErrorPage />} />
      <Route element={<WebAppShell />}>
        <Route index element={<HomePage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workspaces/:workspaceId/chats/:chatId" element={<ChatPage />} />
        <Route path="*" element={<Navigate to={routes.home} replace />} />
      </Route>
    </Routes>
  );
}
