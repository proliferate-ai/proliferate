import type { ComponentType } from "react";
import * as Sentry from "@sentry/react-native";
import type { Breadcrumb, ErrorEvent, SeverityLevel } from "@sentry/react-native";
import {
  scrubTelemetryData,
  scrubTelemetryText,
} from "@proliferate/product-model/telemetry/scrub";

import type { MobileTelemetryConfig } from "./config";

declare const __DEV__: boolean | undefined;

let sentryInitialized = false;

function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return {
    ...breadcrumb,
    message: breadcrumb.message ? scrubTelemetryText(breadcrumb.message) : breadcrumb.message,
    data: scrubTelemetryData(breadcrumb.data),
  };
}

function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  const scrubbed: ErrorEvent = {
    ...event,
    message: event.message ? scrubTelemetryText(event.message) : event.message,
    extra: scrubTelemetryData(event.extra),
    contexts: scrubTelemetryData(event.contexts),
    tags: scrubTelemetryData(event.tags),
  };

  if (scrubbed.user) {
    scrubbed.user = {
      ...scrubbed.user,
      ip_address: undefined,
    };
  }

  if (scrubbed.request) {
    scrubbed.request = {
      ...scrubbed.request,
      data: scrubbed.request.data ? "[redacted]" : scrubbed.request.data,
      cookies: scrubbed.request.cookies ? undefined : scrubbed.request.cookies,
      headers: scrubTelemetryData(scrubbed.request.headers),
      url: scrubbed.request.url ? scrubTelemetryText(scrubbed.request.url) : scrubbed.request.url,
    };
  }

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs
      .map(scrubSentryBreadcrumb)
      .filter((entry: Breadcrumb | null): entry is Breadcrumb => entry !== null);
  }

  return scrubbed;
}

export function initializeMobileSentry(config: {
  environment: string;
  release: string;
  sentry: MobileTelemetryConfig["sentry"];
}): void {
  if (sentryInitialized) return;

  if (!config.sentry.enabled || !config.sentry.dsn) {
    return;
  }

  sentryInitialized = true;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.environment,
    release: config.release,
    attachStacktrace: true,
    maxBreadcrumbs: 100,
    sendDefaultPii: false,
    tracesSampleRate: config.sentry.tracesSampleRate,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableNativeCrashHandling: true,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    initialScope: {
      tags: {
        surface: "mobile",
        telemetry_mode: "hosted_product",
      },
    },
    debug: typeof __DEV__ !== "undefined" && __DEV__,
  });
}

export function wrapMobileSentryRoot<T extends ComponentType<unknown>>(component: T): T {
  if (!sentryInitialized) {
    return component;
  }
  return Sentry.wrap(component) as T;
}

export function setMobileSentryUser(userId: string): void {
  if (!sentryInitialized) return;

  Sentry.setUser({
    id: userId,
  });
}

export function clearMobileSentryUser(): void {
  if (!sentryInitialized) return;
  Sentry.setUser(null);
}

export function addMobileSentryBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!sentryInitialized) return;

  Sentry.addBreadcrumb({
    category: "product",
    message,
    data: scrubTelemetryData(data),
    level: "info",
  });
}

export function captureMobileSentryException(
  error: unknown,
  context?: {
    level?: SeverityLevel;
    tags?: Record<string, string>;
    extras?: Record<string, unknown>;
    fingerprint?: string[];
  },
): void {
  if (!sentryInitialized) return;

  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");

  Sentry.withScope((scope) => {
    if (context?.level) {
      scope.setLevel(context.level);
    }
    if (context?.fingerprint) {
      scope.setFingerprint(context.fingerprint);
    }
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context?.extras) {
      for (const [key, value] of Object.entries(context.extras)) {
        scope.setExtra(key, scrubTelemetryData({ value })?.value);
      }
    }

    Sentry.captureException(normalized);
  });
}
