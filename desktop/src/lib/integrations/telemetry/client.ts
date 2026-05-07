import { OFFICIAL_HOSTED_API_ORIGINS } from "@/config/capabilities";
import {
  handleAnonymousProductEvent,
} from "@/lib/integrations/telemetry/anonymous";
import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import {
  type DesktopTelemetryRoutingState,
  resolveDesktopTelemetryRoutingState,
} from "@/lib/domain/telemetry/mode";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import {
  getProliferateApiBaseUrl,
  getProliferateApiOrigin,
  getRuntimeDesktopAppConfig,
} from "@/lib/infra/proliferate-api";
import {
  getDesktopTelemetryConfig,
  isBuildTelemetryDisabled,
} from "./config";
import {
  identifyDesktopPostHogUser,
  initializeDesktopPostHog,
  resetDesktopPostHogUser,
  trackDesktopPostHogEvent,
} from "./posthog";
import {
  addDesktopSentryBreadcrumb,
  captureDesktopSentryException,
  clearDesktopSentryUser,
  getDesktopRootErrorHandlers,
  initializeDesktopSentry,
  setDesktopSentryTag,
  setDesktopSentryUser,
} from "./sentry";
import { initializeDesktopNativeDiagnostics } from "./native-diagnostics";

let desktopTelemetryRuntimeState: DesktopTelemetryRoutingState | null = null;

const DESKTOP_POSTHOG_EVENT_ALLOWLIST = new Set<keyof DesktopProductEventMap>([
  // Hosted Product PostHog is intentionally limited to a small funnel surface.
  // Other typed product events still become Sentry breadcrumbs when vendor
  // telemetry is enabled, but they do not emit PostHog events by default.
  "chat_session_created",
  "chat_prompt_submitted",
  "workspace_created",
  "cloud_workspace_created",
]);

export function isVendorPostHogEventAllowed(
  name: keyof DesktopProductEventMap,
): boolean {
  return DESKTOP_POSTHOG_EVENT_ALLOWLIST.has(name);
}

function resolveRuntimeState(): DesktopTelemetryRoutingState {
  return resolveDesktopTelemetryRoutingState({
    buildTelemetryDisabled: isBuildTelemetryDisabled(),
    runtimeTelemetryDisabled: getRuntimeDesktopAppConfig().telemetryDisabled,
    viteDev: import.meta.env.DEV,
    nativeDevProfile: getRuntimeDesktopAppConfig().nativeDevProfile,
    apiOrigin: getProliferateApiOrigin(),
    officialHostedOrigins: OFFICIAL_HOSTED_API_ORIGINS,
  });
}

export function initializeDesktopTelemetry(): void {
  if (desktopTelemetryRuntimeState) {
    return;
  }

  const config = getDesktopTelemetryConfig();
  const runtimeState = resolveRuntimeState();
  desktopTelemetryRuntimeState = runtimeState;
  initializeDesktopNativeDiagnostics();

  if (!runtimeState.vendorEnabled) {
    return;
  }

  initializeDesktopSentry({
    environment: config.environment,
    release: config.release,
    sentry: config.sentry,
    apiBaseUrl: getProliferateApiBaseUrl(),
    telemetryMode: runtimeState.telemetryMode,
  });
  initializeDesktopPostHog({
    posthog: config.posthog,
  });
}

export function getDesktopTelemetryRootHandlers() {
  return getDesktopRootErrorHandlers();
}

export function getDesktopTelemetryRuntimeState(): DesktopTelemetryRoutingState {
  if (!desktopTelemetryRuntimeState) {
    desktopTelemetryRuntimeState = resolveRuntimeState();
  }

  return desktopTelemetryRuntimeState;
}

export function trackProductEvent<E extends keyof DesktopProductEventMap>(
  name: E,
  properties: DesktopProductEventMap[E],
): void {
  const runtimeState = getDesktopTelemetryRuntimeState();

  if (runtimeState.anonymousEnabled) {
    handleAnonymousProductEvent(name, properties);
  }

  if (!runtimeState.vendorEnabled) {
    return;
  }

  addDesktopSentryBreadcrumb(name, properties);
  if (isVendorPostHogEventAllowed(name)) {
    trackDesktopPostHogEvent(name, properties);
  }
}

export function captureTelemetryException(
  error: unknown,
  context?: Parameters<typeof captureDesktopSentryException>[1],
): void {
  if (!getDesktopTelemetryRuntimeState().vendorEnabled) {
    return;
  }

  captureDesktopSentryException(error, context);
}

export function setTelemetryUser(user: AuthUser): void {
  if (!getDesktopTelemetryRuntimeState().vendorEnabled) {
    return;
  }

  setDesktopSentryUser(user.id);
  identifyDesktopPostHogUser(user);
}

export function clearTelemetryUser(): void {
  if (!getDesktopTelemetryRuntimeState().vendorEnabled) {
    return;
  }

  clearDesktopSentryUser();
  resetDesktopPostHogUser();
}

export function setTelemetryTag(key: string, value: string): void {
  if (!getDesktopTelemetryRuntimeState().vendorEnabled) {
    return;
  }

  setDesktopSentryTag(key, value);
}
