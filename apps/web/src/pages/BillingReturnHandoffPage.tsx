import { useEffect, useMemo, useState } from "react";
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
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);
  const deepLinkUrl = useMemo(
    () => desktopBillingDeepLink(location.search),
    [location.search],
  );
  const webBillingPath = useMemo(
    () => webBillingSettingsPath(location.search),
    [location.search],
  );

  useEffect(() => {
    if (shouldReturnToDesktop) {
      window.location.replace(deepLinkUrl);
    }
  }, [deepLinkUrl, shouldReturnToDesktop]);

  useEffect(() => {
    if (!shouldReturnToDesktop) {
      return;
    }

    const timer = window.setTimeout(() => setHandoffTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [shouldReturnToDesktop]);

  if (!shouldReturnToDesktop) {
    return <Navigate to={webBillingPath} replace />;
  }

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title="Desktop did not open"
        description="The billing return link is ready, but the operating system has not handed it to Proliferate Desktop."
        statusLabel="Billing redirect waiting"
        primaryAction={{
          label: "Try opening Desktop again",
          onClick: () => window.location.assign(deepLinkUrl),
        }}
        secondaryAction={{
          label: "Open billing in browser",
          onClick: () => window.location.assign(webBillingPath),
        }}
      />
    );
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
