import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js/lib/src/types";
import type { AuthUser } from "@proliferate/cloud-sdk";
import { scrubTelemetryData } from "@proliferate/product-model/telemetry/scrub";

import type { WebTelemetryConfig } from "./config";

let posthogInitialized = false;
const POSTHOG_URL_PROPERTY_KEYS = [
  "$current_url",
  "$pathname",
  "$host",
  "$referrer",
  "$referring_domain",
];

interface WebPostHogInitConfig {
  environment: string;
  release: string;
  posthog: WebTelemetryConfig["posthog"];
}

export type WebTelemetryRoute =
  | "auth"
  | "auth_callback"
  | "auth_error"
  | "desktop_handoff"
  | "connect_github"
  | "home"
  | "workspaces"
  | "chat"
  | "automations"
  | "plugins"
  | "support"
  | "settings"
  | "unknown";

function scrubPostHogCapture(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  const scrubbed = scrubTelemetryData(event, { preservePostHogInternalKeys: true });
  if (scrubbed.properties) {
    for (const key of POSTHOG_URL_PROPERTY_KEYS) {
      delete scrubbed.properties[key];
    }
  }
  return scrubbed;
}

export function initializeWebPostHog(config: WebPostHogInitConfig): void {
  if (posthogInitialized) return;

  if (!config.posthog.enabled || !config.posthog.apiKey) {
    return;
  }

  posthogInitialized = true;

  posthog.init(config.posthog.apiKey, {
    api_host: config.posthog.apiHost,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    person_profiles: "identified_only",
    before_send: scrubPostHogCapture,
    disable_session_recording: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-telemetry-mask]",
      blockSelector: "[data-telemetry-block]",
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: () => null,
    },
  });

  posthog.register({
    app: "proliferate-web",
    surface: "web",
    environment: config.environment,
    release: config.release,
  });
}

export function trackWebPostHogPageView(route: WebTelemetryRoute): void {
  if (!posthogInitialized) return;
  posthog.capture("web_page_viewed", scrubTelemetryData({
    route,
    surface: "web",
  }));
}

export function identifyWebPostHogUser(user: AuthUser): void {
  if (!posthogInitialized) return;
  const properties: Record<string, string> = { email: user.email };
  if (user.display_name) {
    properties.display_name = user.display_name;
  }

  posthog.identify(
    user.id,
    scrubTelemetryData(properties),
  );
}

export function resetWebPostHogUser(): void {
  if (!posthogInitialized) return;
  posthog.reset(true);
}

export function webTelemetryRouteForPathname(pathname: string): WebTelemetryRoute {
  const normalized = pathname.replace(/\/+$/u, "") || "/";

  if (normalized === "/auth") return "auth";
  if (normalized === "/auth/callback") return "auth_callback";
  if (normalized === "/auth/error") return "auth_error";
  if (normalized === "/auth/desktop/handoff") return "desktop_handoff";
  if (normalized === "/connect-github") return "connect_github";
  if (normalized === "/") return "home";
  if (normalized === "/workspaces") return "workspaces";
  if (/^\/workspaces\/[^/]+\/chats\/[^/]+$/u.test(normalized)) return "chat";
  if (normalized === "/automations") return "automations";
  if (normalized === "/plugins") return "plugins";
  if (normalized === "/support") return "support";
  if (normalized === "/settings") return "settings";

  return "unknown";
}
