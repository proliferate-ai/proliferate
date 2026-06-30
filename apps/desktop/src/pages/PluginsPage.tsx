import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CloudPluginsSurface,
  type CloudPluginsLocalOAuthAdapter,
  type PluginOAuthCompletionState,
} from "@proliferate/product-surfaces/plugins/CloudPluginsSurface";
import type { PluginSettings } from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type { PluginIconRenderer } from "@proliferate/product-ui/plugins/PluginsSurface";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES } from "@/config/app-routes";
import {
  cancelPendingLocalOAuthConnectorConnect,
  useDeleteConnectorMutation,
  useInstallConnectorMutation,
  useReconnectOAuthConnectorMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { getGoogleWorkspaceMcpCredentialStatus } from "@/lib/access/tauri/google-workspace-mcp";
import { readUserGoogleEmail } from "@/lib/workflows/mcp/local-oauth-persistence";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";

export function PluginsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openExternal } = useTauriShellActions();
  const { mutateAsync: installConnector } = useInstallConnectorMutation();
  const { mutateAsync: reconnectOAuthConnector } = useReconnectOAuthConnectorMutation();
  const { mutateAsync: deleteConnector } = useDeleteConnectorMutation();
  const completion = useMemo(
    () => pluginCompletionFromSearch(location.search),
    [location.search],
  );
  const localOAuthAdapter = useMemo<CloudPluginsLocalOAuthAdapter>(() => ({
    async connect(input) {
      await installConnector({
        catalogEntryId: input.catalogEntryId,
        secretFields: {},
        settings: connectorSettings(input.settings),
      });
    },
    async reconnect(input) {
      await reconnectOAuthConnector({
        catalogEntryId: input.catalogEntryId,
        connectionId: input.connectionId,
        settings: connectorSettings(input.settings),
      });
    },
    async delete(input) {
      await deleteConnector({
        catalogEntryId: input.catalogEntryId,
        connectionId: input.connectionId,
      });
    },
    cancelPending: cancelPendingLocalOAuthConnectorConnect,
    async getCredentialStatus(input) {
      const userGoogleEmail = readUserGoogleEmail(connectorSettings(input.settings));
      if (!userGoogleEmail) {
        return "not_ready";
      }
      const status = await getGoogleWorkspaceMcpCredentialStatus({ userGoogleEmail });
      return status.status === "ready" ? "ready" : "not_ready";
    },
  }), [
    deleteConnector,
    installConnector,
    reconnectOAuthConnector,
  ]);

  return (
    <MainSidebarPageShell>
      <CloudPluginsSurface
        surface="desktop"
        completion={completion}
        localOAuthAdapter={localOAuthAdapter}
        renderIcon={renderDesktopPluginIcon}
        onCompletionHandled={() => {
          navigate(APP_ROUTES.integrations, { replace: true });
        }}
        onOpenUrl={openExternal}
      />
    </MainSidebarPageShell>
  );
}

const renderDesktopPluginIcon: PluginIconRenderer = (item, size) => (
  <ConnectorIcon entry={item.entry} size={size} />
);

function connectorSettings(
  settings: PluginSettings | undefined,
): ConnectorSettings | undefined {
  return settings as ConnectorSettings | undefined;
}

function pluginCompletionFromSearch(search: string): PluginOAuthCompletionState | null {
  const params = new URLSearchParams(search);
  if (params.get("source") !== "mcp_oauth_callback") {
    return null;
  }
  return {
    source: "mcp_oauth_callback",
    status: params.get("status"),
    flowId: params.get("flowId"),
    failureCode: params.get("failureCode"),
  };
}
