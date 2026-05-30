import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  CloudPluginsSurface,
  type PluginOAuthCompletionState,
} from "@proliferate/product-surfaces/plugins/CloudPluginsSurface";

import { routes } from "../../../config/routes";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function PluginsScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const completion = useMemo(
    () => pluginCompletionFromSearch(location.search),
    [location.search],
  );

  return (
    <CloudPluginsSurface
      surface="web"
      completion={completion}
      onCompletionHandled={() => {
        navigate(routes.plugins, { replace: true });
      }}
      prepareOAuthHandoff={() => {
        const popup = window.open("about:blank", "_blank");
        if (!popup) {
          return null;
        }
        popup.opener = null;
        return {
          open(url) {
            popup.location.href = url;
          },
          close() {
            popup.close();
          },
        };
      }}
      onOpenUrl={(url) => {
        window.open(url, "_blank", "noopener,noreferrer") ?? window.location.assign(url);
      }}
      onOpenDesktop={() => {
        window.location.assign(`${desktopDeepLinkScheme()}://plugins`);
      }}
    />
  );
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

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
}
