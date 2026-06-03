import { useEffect, useState } from "react";
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

import { routes } from "../config/routes";

const HANDOFF_TIMEOUT_MS = 8000;
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
}

export function DesktopHandoffPage() {
  const desktopHref = `${desktopDeepLinkScheme()}://`;
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);

  useEffect(() => {
    window.location.replace(desktopHref);
  }, [desktopHref]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHandoffTimedOut(true), HANDOFF_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title="Desktop did not open"
        description="The desktop link is ready, but the browser has not handed it to Proliferate Desktop."
        statusLabel="Desktop redirect waiting"
        primaryAction={{
          label: "Try opening Desktop again",
          onClick: () => window.location.assign(desktopHref),
        }}
        secondaryAction={{
          label: "Open web app",
          onClick: () => window.location.assign(routes.home),
        }}
      />
    );
  }

  return (
    <RedirectCallbackScreen
      title="Desktop handoff done"
      description="Redirecting to desktop app..."
      statusLabel="Desktop handoff"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(desktopHref),
      }}
    />
  );
}
