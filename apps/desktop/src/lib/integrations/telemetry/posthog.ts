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
 * Network capture is refused outright rather than masked.
 *
 * `before_send` is the single load-bearing boundary for route identifiers.
 * It must keep covering URL-valued DOM attributes inside `$snapshot_data`,
 * not only the rrweb Meta event and the `$current_url`-style properties. Do
 * not narrow it on the assumption that `maskAttributeFn` covers attributes:
 * the pinned `posthog-js@1.386.8` never invokes that callback. Its bundled
 * recorder contains zero occurrences of the name, and the SDK forwards
 * exactly three masking keys to rrweb (`maskAllInputs`, `maskTextSelector`,
 * `blockSelector`) in the `Th` getter of `dist/lazy-recorder.js`. The option
 * is declared only by the newer transitive `@posthog/types@1.404.1`, which is
 * why it typechecks. It is kept here so the recorder boundary starts working
 * on its own the day the SDK pin moves to a version that honors it, and
 * `route-id-redaction.test.ts` asserts the capture boundary closes the leak
 * without it.
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
  // Pins canvas recording off against the provider. Without this key the
  // resolution in the `Rh` getter of posthog-js `dist/lazy-recorder.js` is
  // `config.session_recording.captureCanvas?.recordCanvas ??
  // remoteConfig.canvasRecording?.enabled`, so the PostHog project alone could
  // turn it on. That matters here: `@xterm/addon-canvas` renders terminal
  // output to a canvas, and canvas frames are captured as pixels, which
  // `maskTextSelector: "*"` does not reach. A literal `false` wins the `??`.
  captureCanvas: { recordCanvas: false },
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
    // Pins console capture off against the provider. The `xh` getter in
    // posthog-js `dist/lazy-recorder.js` resolves
    // `config.enable_recording_console_log ??
    // remoteConfig.consoleLogRecordingEnabled`, so leaving it unset would let
    // the PostHog project alone start recording console output into the replay
    // stream. Console arguments are arbitrary app strings that the route-id
    // redactor deliberately does not rewrite, so this has to be a local literal.
    enable_recording_console_log: false,
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
