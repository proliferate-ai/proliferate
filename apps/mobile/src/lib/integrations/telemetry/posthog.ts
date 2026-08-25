import { PostHog } from "posthog-react-native";
import type { PostHogOptions } from "posthog-react-native";
import { scrubTelemetryData } from "@proliferate/product-client/internal/domain/telemetry/scrub";

import type { MobileTelemetryConfig } from "./config";

let posthogClient: PostHog | null = null;
let posthogInitialized = false;

type MobileBeforeSend = Exclude<PostHogOptions["before_send"], undefined | unknown[]>;

interface MobilePostHogInitConfig {
  environment: string;
  release: string;
  posthog: MobileTelemetryConfig["posthog"];
}

export type MobileTelemetryScreen =
  | "home"
  | "work"
  | "settings"
  | "chat";

const scrubPostHogCapture: MobileBeforeSend = (event) => {
  if (!event) return event;
  return scrubTelemetryData(event, { preservePostHogInternalKeys: true });
};

export function initializeMobilePostHog(config: MobilePostHogInitConfig): void {
  if (posthogInitialized) return;

  if (!config.posthog.enabled || !config.posthog.apiKey) {
    return;
  }

  posthogInitialized = true;
  posthogClient = new PostHog(config.posthog.apiKey, {
    host: config.posthog.apiHost,
    captureAppLifecycleEvents: false,
    before_send: scrubPostHogCapture,
    // Source-owned fail-closed assertion (CP-C1PM): not a configuration
    // surface. No build variable, provider setting, or runtime value reaches
    // this literal. Re-enabling Mobile replay needs a new reviewed source PR.
    enableSessionReplay: false,
  });

  void posthogClient.register({
    app: "proliferate-mobile",
    surface: "mobile",
    environment: config.environment,
    release: config.release,
  });
}

export function trackMobilePostHogScreenView(screen: MobileTelemetryScreen): void {
  if (!posthogClient) return;
  posthogClient.capture("mobile_screen_viewed", scrubTelemetryData({
    screen,
    surface: "mobile",
  }));
}

export function identifyMobilePostHogUser(userId: string): void {
  if (!posthogClient) return;
  posthogClient.identify(userId);
}

export function resetMobilePostHogUser(): void {
  if (!posthogClient) return;
  posthogClient.reset();
}
