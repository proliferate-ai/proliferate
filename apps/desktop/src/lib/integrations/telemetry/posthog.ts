import posthog from "posthog-js";
import type { DesktopTelemetryConfig } from "./config";
import type { DesktopProductEventMap } from "@proliferate/product-client/internal/lib/domain/telemetry/events";
import { scrubPostHogPayload, scrubTelemetryData } from "./scrub";

let posthogInitialized = false;

interface DesktopPostHogInitConfig {
  environment: string;
  release: string;
  posthog: DesktopTelemetryConfig["posthog"];
}

export function initializeDesktopPostHog(config: DesktopPostHogInitConfig): void {
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
    before_send: scrubPostHogPayload,
    disable_session_recording: true,
  });

  posthog.register({
    app: "proliferate-desktop",
    surface: "desktop",
    environment: config.environment,
    release: config.release,
  });
}

export function trackDesktopPostHogEvent<E extends keyof DesktopProductEventMap>(
  name: E,
  properties: DesktopProductEventMap[E],
): void {
  if (!posthogInitialized) return;
  posthog.capture(name, scrubTelemetryData(properties));
}

export function identifyDesktopPostHogUser(userId: string): void {
  if (!posthogInitialized) return;

  posthog.identify(userId);
}

export function resetDesktopPostHogUser(): void {
  if (!posthogInitialized) return;
  posthog.reset(true);
}

export function getDesktopPostHogSupportRefs(): {
  posthogDistinctId?: string;
  posthogSessionId?: string;
} {
  if (!posthogInitialized) {
    return {};
  }
  const client = posthog as unknown as {
    get_distinct_id?: () => string | undefined;
    get_session_id?: () => string | undefined;
  };
  return {
    posthogDistinctId: client.get_distinct_id?.(),
    posthogSessionId: client.get_session_id?.(),
  };
}
