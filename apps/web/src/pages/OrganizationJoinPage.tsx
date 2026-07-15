import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { discoverSso } from "@proliferate/cloud-sdk";
import { useCloudClient } from "@proliferate/cloud-sdk-react";
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";
import {
  canUseDevDesktopHandoff,
  getDevDesktopHandoff,
  queueDevDesktopHandoff,
} from "../lib/access/cloud/dev-desktop-handoff";
import { startWebSsoFlow } from "../lib/access/cloud/auth/web-auth-flow";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const DEV_HANDOFF_STATUS_POLL_MS = 500;

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
  const cloudClient = useCloudClient();
  // Try to sign the user in on the web first: if the org has SSO enabled, the
  // start flow redirects to the identity provider (JIT membership / invite
  // acceptance happen in the SSO callback). Only when SSO is not available do
  // we fall back to handing the invite off to Desktop.
  const [joinPhase, setJoinPhase] = useState<"resolving" | "desktop">("resolving");
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);
  const [devHandoffQueued, setDevHandoffQueued] = useState(false);
  const [devHandoffId, setDevHandoffId] = useState<string | null>(null);
  const [devHandoffOpened, setDevHandoffOpened] = useState(false);
  const [handoffAttempt, setHandoffAttempt] = useState(0);
  const deepLinkUrl = useMemo(
    () => organizationId ? organizationJoinDeepLink(organizationId) : null,
    [organizationId],
  );
  const openInvite = useCallback(async () => {
    if (!deepLinkUrl) {
      return;
    }

    setHandoffTimedOut(false);
    setDevHandoffQueued(false);
    setDevHandoffId(null);
    setDevHandoffOpened(false);
    setHandoffAttempt((attempt) => attempt + 1);
    if (canUseDevDesktopHandoff()) {
      try {
        const handoff = await queueDevDesktopHandoff(deepLinkUrl);
        if (handoff) {
          setDevHandoffQueued(true);
          setDevHandoffId(handoff.id);
          setDevHandoffOpened(Boolean(handoff.openedAt));
          return;
        }
      } catch {
        // Fall through to the OS deep-link attempt.
      }
    }

    window.location.assign(deepLinkUrl);
  }, [deepLinkUrl]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const discovery = await discoverSso({ organizationId }, cloudClient);
        if (cancelled) {
          return;
        }
        if (discovery.enabled && discovery.organizationId) {
          await startWebSsoFlow({
            organizationId: discovery.organizationId,
            connectionId: discovery.connectionId,
          });
          return;
        }
      } catch {
        // Fall through to the Desktop handoff when SSO cannot be resolved.
      }
      if (!cancelled) {
        setJoinPhase("desktop");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, cloudClient]);

  useEffect(() => {
    if (!deepLinkUrl || joinPhase !== "desktop") {
      return;
    }
    void openInvite();
  }, [deepLinkUrl, joinPhase, openInvite]);

  useEffect(() => {
    if (!devHandoffId || devHandoffOpened) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let abortController: AbortController | null = null;

    const pollStatus = () => {
      if (cancelled) {
        return;
      }
      abortController = new AbortController();
      void getDevDesktopHandoff(devHandoffId, abortController.signal)
        .then((handoff) => {
          if (!cancelled && handoff?.openedAt) {
            setHandoffTimedOut(false);
            setDevHandoffOpened(true);
          }
        })
        .catch(() => {
          // The dev API may restart; the retry action can queue a fresh handoff.
        })
        .finally(() => {
          abortController = null;
          if (!cancelled) {
            timeoutId = window.setTimeout(pollStatus, DEV_HANDOFF_STATUS_POLL_MS);
          }
        });
    };

    pollStatus();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      abortController?.abort();
    };
  }, [devHandoffId, devHandoffOpened]);

  useEffect(() => {
    if (!deepLinkUrl || handoffAttempt === 0 || devHandoffOpened) {
      return;
    }
    const timer = window.setTimeout(() => setHandoffTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [deepLinkUrl, devHandoffOpened, handoffAttempt]);

  if (!deepLinkUrl) {
    return <Navigate to="/" replace />;
  }

  if (joinPhase === "resolving") {
    return (
      <RedirectCallbackScreen
        title="Signing you in"
        description="Checking your organization's sign-in options..."
        statusLabel="Organization sign-in"
        variant="handoff"
      />
    );
  }

  if (devHandoffOpened) {
    return (
      <RedirectCallbackScreen
        title="Opened in Desktop"
        description="The organization invite was sent to local Proliferate Desktop."
        detail="Continue in the matching Desktop dev profile."
        statusLabel="Organization invite opened"
        variant="handoff"
        primaryAction={{
          label: "Send to Desktop again",
          onClick: () => {
            void openInvite();
          },
        }}
      />
    );
  }

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title={devHandoffQueued ? "Desktop handoff waiting" : "Desktop did not open"}
        description={
          devHandoffQueued
            ? "The organization invite was sent to local Proliferate Desktop, but Desktop has not confirmed it opened."
            : "The organization invite is ready, but the operating system has not handed it to Proliferate Desktop."
        }
        detail={
          devHandoffQueued
            ? "Bring the matching Desktop dev profile to the front, or try again."
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
