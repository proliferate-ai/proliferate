import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import { initializeDesktopPostHog, trackDesktopPostHogEvent, identifyDesktopPostHogUser, resetDesktopPostHogUser } from "./posthog";
import {
  addDesktopSentryBreadcrumb,
  captureDesktopSentryException,
  clearDesktopSentryUser,
  getDesktopRootErrorHandlers,
  initializeDesktopSentry,
  setDesktopSentryTag,
  setDesktopSentryUser,
} from "./sentry";

export function initializeDesktopTelemetry(): void {
  initializeDesktopSentry();
  initializeDesktopPostHog();
}

export function getDesktopTelemetryRootHandlers() {
  return getDesktopRootErrorHandlers();
}

export function trackProductEvent<E extends keyof DesktopProductEventMap>(
  name: E,
  properties: DesktopProductEventMap[E],
): void {
  addDesktopSentryBreadcrumb(name, properties);
  trackDesktopPostHogEvent(name, properties);
}

export function captureTelemetryException(
  error: unknown,
  context?: Parameters<typeof captureDesktopSentryException>[1],
): void {
  captureDesktopSentryException(error, context);
}

export function setTelemetryUser(user: AuthUser): void {
  setDesktopSentryUser(user);
  identifyDesktopPostHogUser(user);
}

export function clearTelemetryUser(): void {
  clearDesktopSentryUser();
  resetDesktopPostHogUser();
}

export function setTelemetryTag(key: string, value: string): void {
  setDesktopSentryTag(key, value);
}
