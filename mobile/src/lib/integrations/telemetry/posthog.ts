import { PostHog } from "posthog-react-native";
import type { AuthUser } from "@proliferate/cloud-sdk";
import { scrubTelemetryData } from "@proliferate/product-model/telemetry/scrub";

import type { MobileTelemetryConfig } from "./config";

let posthogClient: PostHog | null = null;
let posthogInitialized = false;

interface MobilePostHogInitConfig {
  environment: string;
  release: string;
  posthog: MobileTelemetryConfig["posthog"];
}

export type MobileTelemetryScreen =
  | "home"
  | "workspaces"
  | "sessions"
  | "automations"
  | "settings"
  | "chat";

export function initializeMobilePostHog(config: MobilePostHogInitConfig): void {
  if (posthogInitialized) return;

  if (!config.posthog.enabled || !config.posthog.apiKey) {
    return;
  }

  posthogInitialized = true;
  posthogClient = new PostHog(config.posthog.apiKey, {
    host: config.posthog.apiHost,
    captureAppLifecycleEvents: true,
    enableSessionReplay: config.posthog.sessionReplayEnabled,
    sessionReplayConfig: config.posthog.sessionReplayEnabled
      ? {
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureLog: false,
        captureNetworkTelemetry: false,
        throttleDelayMs: 1000,
      }
      : undefined,
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

export function identifyMobilePostHogUser(user: AuthUser): void {
  if (!posthogClient) return;
  const properties: Record<string, string> = { email: user.email };
  if (user.display_name) {
    properties.display_name = user.display_name;
  }

  posthogClient.identify(
    user.id,
    scrubTelemetryData(properties),
  );
}

export function resetMobilePostHogUser(): void {
  if (!posthogClient) return;
  posthogClient.reset();
}
