import posthog from "posthog-js";
import type { DesktopTelemetryConfig } from "./config";
import type { DesktopProductEventMap } from "@proliferate/product-client/internal/lib/domain/telemetry/events";
import { redactRouteIdentifiersInAttribute } from "@proliferate/product-client/internal/domain/telemetry/route-id-redaction";
import { scrubPostHogPayload, scrubTelemetryData } from "./scrub";

let posthogInitialized = false;
let sessionReplayStarted = false;

/**
 * Recorder configuration for Desktop session replay.
 *
 * Masking and redaction are separate concerns and both are required. Masking
 * (`maskAllInputs`, `maskTextSelector: "*"`, `blockSelector`) hides rendered
 * page *content*. It does nothing about URLs, which is exactly why the
 * 2026-08-18 disable (#2093) could not be answered with masking alone.
 * `maskAttributeFn` closes the attribute half of that gap at the recorder
 * boundary, and `before_send` closes the event-property and rrweb Meta-event
 * half. Network capture is refused outright rather than masked.
 */
export const DESKTOP_SESSION_RECORDING_OPTIONS = {
  maskAllInputs: true,
  maskTextSelector: "*",
  blockSelector: "[data-telemetry-block]",
  maskAttributeFn: (name: string, value: string) =>
    redactRouteIdentifiersInAttribute(name, value),
  collectFonts: false,
  recordCrossOriginIframes: false,
  recordHeaders: false,
  recordBody: false,
  maskCapturedNetworkRequestFn: () => null,
} as const;

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
    // Recording never auto-starts. It begins only when
    // `startDesktopPostHogSessionReplay()` is called for a signed-in member of
    // the internal replay audience, and only if the PostHog project has replay
    // enabled server-side as well (posthog-js
    // `src/extensions/replay/session-recording.ts` `_isRecordingEnabled`
    // requires `enabled_server_side && !disable_session_recording`).
    disable_session_recording: true,
    session_recording: DESKTOP_SESSION_RECORDING_OPTIONS,
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

/**
 * Begin recording. Only `client.ts` calls this, and only after checking
 * `isInternalReplayAudience(user.email)`; there is no configuration surface
 * that reaches it.
 */
export function startDesktopPostHogSessionReplay(): void {
  if (!posthogInitialized || sessionReplayStarted) return;
  sessionReplayStarted = true;
  posthog.startSessionRecording();
}

export function stopDesktopPostHogSessionReplay(): void {
  if (!posthogInitialized || !sessionReplayStarted) return;
  sessionReplayStarted = false;
  posthog.stopSessionRecording();
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
