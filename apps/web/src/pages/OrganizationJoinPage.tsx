import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
}

function organizationJoinDeepLink(organizationId: string): string {
  const url = new URL(`${desktopDeepLinkScheme()}://join/${organizationId}`);
  return url.toString();
}

export function OrganizationJoinPage() {
  const { organizationId } = useParams();
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);
  const deepLinkUrl = useMemo(
    () => organizationId ? organizationJoinDeepLink(organizationId) : null,
    [organizationId],
  );

  useEffect(() => {
    if (!deepLinkUrl) {
      return;
    }
    window.location.replace(deepLinkUrl);
  }, [deepLinkUrl]);

  useEffect(() => {
    if (!deepLinkUrl) {
      return;
    }
    const timer = window.setTimeout(() => setHandoffTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [deepLinkUrl]);

  if (!deepLinkUrl) {
    return <Navigate to="/" replace />;
  }

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title="Desktop did not open"
        description="The organization invite is ready, but the operating system has not handed it to Proliferate Desktop."
        detail="Install Proliferate Desktop, then try opening the invite again."
        statusLabel="Organization invite waiting"
        primaryAction={{
          label: "Try opening Desktop again",
          onClick: () => window.location.assign(deepLinkUrl),
        }}
      />
    );
  }

  return (
    <RedirectCallbackScreen
      title="Opening invite"
      description="Opening Proliferate Desktop..."
      statusLabel="Organization invite"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(deepLinkUrl),
      }}
    />
  );
}
