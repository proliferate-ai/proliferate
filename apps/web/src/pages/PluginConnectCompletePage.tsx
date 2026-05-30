import { useEffect, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

import { routes } from "../config/routes";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
}

function completionParams(search: string): URLSearchParams {
  const input = new URLSearchParams(search);
  const output = new URLSearchParams();
  output.set("source", "mcp_oauth_callback");
  for (const key of ["status", "flowId", "failureCode"]) {
    const value = input.get(key);
    if (value) {
      output.set(key, value);
    }
  }
  return output;
}

function desktopPluginsDeepLink(search: string): string {
  const url = new URL(`${desktopDeepLinkScheme()}://plugins`);
  const params = completionParams(search);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function webPluginsPath(search: string): string {
  const query = completionParams(search).toString();
  return query ? `${routes.plugins}?${query}` : routes.plugins;
}

export function PluginConnectCompletePage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const finalSurface = params.get("finalSurface");
  const shouldReturnToDesktop = finalSurface === "desktop";
  const desktopDeepLink = useMemo(
    () => desktopPluginsDeepLink(location.search),
    [location.search],
  );

  useEffect(() => {
    if (shouldReturnToDesktop) {
      window.location.replace(desktopDeepLink);
    }
  }, [desktopDeepLink, shouldReturnToDesktop]);

  if (!shouldReturnToDesktop) {
    return <Navigate to={webPluginsPath(location.search)} replace />;
  }

  return (
    <RedirectCallbackScreen
      title="Plugin connected"
      description="Opening Proliferate Desktop..."
      statusLabel="Plugin redirect"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(desktopDeepLink),
      }}
    />
  );
}
