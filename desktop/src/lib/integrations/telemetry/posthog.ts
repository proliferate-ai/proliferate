import posthog from "posthog-js";
import type { PostHogInterface } from "posthog-js/lib/src/types";
import type { DesktopTelemetryConfig } from "./config";
import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import { scrubTelemetryData } from "./scrub";

let posthogInitialized = false;

interface DesktopPostHogInitConfig {
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
    disable_session_recording: !config.posthog.sessionRecordingEnabled,
    session_recording: config.posthog.sessionRecordingEnabled
      ? {
        maskAllInputs: true,
        maskTextSelector: "[data-telemetry-mask]",
        blockSelector: "[data-telemetry-block]",
      }
      : undefined,
    loaded: config.posthog.sessionRecordingEnabled
      ? (client: PostHogInterface) => {
        client.startSessionRecording();
      }
      : undefined,
  });
}

export function trackDesktopPostHogEvent<E extends keyof DesktopProductEventMap>(
  name: E,
  properties: DesktopProductEventMap[E],
): void {
  if (!posthogInitialized) return;
  posthog.capture(name, scrubTelemetryData(properties));
}

export function identifyDesktopPostHogUser(user: {
  id: string;
  email: string;
  display_name: string | null;
}): void {
  if (!posthogInitialized) return;

  posthog.identify(
    user.id,
    scrubTelemetryData({
      email: user.email,
      display_name: user.display_name ?? undefined,
    }),
  );
}

export function resetDesktopPostHogUser(): void {
  if (!posthogInitialized) return;
  posthog.reset(true);
}
