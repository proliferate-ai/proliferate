import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";
import {
  canUseDevDesktopHandoff,
  queueDevDesktopHandoff,
} from "../lib/access/cloud/dev-desktop-handoff";

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
  const [devHandoffQueued, setDevHandoffQueued] = useState(false);
  const deepLinkUrl = useMemo(
    () => organizationId ? organizationJoinDeepLink(organizationId) : null,
    [organizationId],
  );
  const openInvite = useCallback(async () => {
    if (!deepLinkUrl) {
      return;
    }

    setHandoffTimedOut(false);
    if (canUseDevDesktopHandoff()) {
      try {
        const queued = await queueDevDesktopHandoff(deepLinkUrl);
        if (queued) {
          setDevHandoffQueued(true);
          return;
        }
      } catch {
        // Fall through to the OS deep-link attempt.
      }
    }

    window.location.assign(deepLinkUrl);
  }, [deepLinkUrl]);

  useEffect(() => {
    if (!deepLinkUrl) {
      return;
    }
    void openInvite();
  }, [deepLinkUrl, openInvite]);

  useEffect(() => {
    if (!deepLinkUrl || devHandoffQueued) {
      return;
    }
    const timer = window.setTimeout(() => setHandoffTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [deepLinkUrl, devHandoffQueued]);

  if (!deepLinkUrl) {
    return <Navigate to="/" replace />;
  }

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title="Desktop did not open"
        description={
          devHandoffQueued
            ? "The organization invite was sent to local Proliferate Desktop, but Desktop has not opened it."
            : "The organization invite is ready, but the operating system has not handed it to Proliferate Desktop."
        }
        detail={
          devHandoffQueued
            ? "Keep the matching Desktop dev profile running, then try again."
            : "Install Proliferate Desktop, then try opening the invite again."
        }
        statusLabel="Organization invite waiting"
        primaryAction={{
          label: "Try opening Desktop again",
          onClick: () => {
            void openInvite();
          },
        }}
      />
    );
  }

  return (
    <RedirectCallbackScreen
      title="Opening invite"
      description={
        devHandoffQueued
          ? "Sent to local Proliferate Desktop."
          : "Opening Proliferate Desktop..."
      }
      statusLabel="Organization invite"
      variant="handoff"
      primaryAction={{
        label: devHandoffQueued ? "Send to Desktop again" : "Click here if not redirected",
        onClick: () => {
          void openInvite();
        },
      }}
    />
  );
}
