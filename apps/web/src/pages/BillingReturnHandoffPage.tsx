import { useEffect, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
}

function desktopBillingDeepLink(search: string): string {
  const url = new URL(`${desktopDeepLinkScheme()}://settings/cloud`);
  const params = new URLSearchParams(search);
  params.delete("returnSurface");
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function webBillingSettingsPath(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("returnSurface");
  const query = params.toString();
  return query ? `/settings/billing?${query}` : "/settings/billing";
}

export function BillingReturnHandoffPage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const shouldReturnToDesktop = params.get("returnSurface") === "desktop";
  const deepLinkUrl = useMemo(
    () => desktopBillingDeepLink(location.search),
    [location.search],
  );

  useEffect(() => {
    if (shouldReturnToDesktop) {
      window.location.replace(deepLinkUrl);
    }
  }, [deepLinkUrl, shouldReturnToDesktop]);

  if (!shouldReturnToDesktop) {
    return <Navigate to={webBillingSettingsPath(location.search)} replace />;
  }

  return (
    <RedirectCallbackScreen
      title="Billing done"
      description="Opening Proliferate Desktop..."
      statusLabel="Billing redirect"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(deepLinkUrl),
      }}
    />
  );
}
