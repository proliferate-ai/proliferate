import * as React from "react";
import * as Sentry from "@sentry/react";
import {
  createRoutesFromChildren,
  matchRoutes,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import type { Breadcrumb, ErrorEvent, SeverityLevel } from "@sentry/react";
import {
  scrubTelemetryData,
  scrubTelemetryText,
} from "@proliferate/product-model/telemetry/scrub";

import type { WebTelemetryConfig } from "./config";

export const InstrumentedRoutes = (() => {
  try {
    return Sentry.withSentryReactRouterV7Routing(Routes);
  } catch {
    return Routes;
  }
})();

let sentryInitialized = false;

function buildTracePropagationTargets(apiBaseUrl: string): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [
    "localhost",
    "127.0.0.1",
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  ];

  const trimmed = apiBaseUrl.trim();
  if (trimmed) {
    targets.push(trimmed);
  }

  return targets;
}

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

export function initializeWebSentry(config: {
  environment: string;
  release: string;
  sentry: WebTelemetryConfig["sentry"];
  apiBaseUrl: string;
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
    enableLogs: config.sentry.enableLogs,
    tracesSampleRate: config.sentry.tracesSampleRate,
    tracePropagationTargets: buildTracePropagationTargets(config.apiBaseUrl),
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    initialScope: {
      tags: {
        surface: "web",
        telemetry_mode: "hosted_product",
      },
    },
  });
}

export function getWebRootErrorHandlers() {
  if (!sentryInitialized) {
    return {};
  }

  return {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  };
}

export function setWebSentryUser(userId: string): void {
  if (!sentryInitialized) return;

  Sentry.setUser({
    id: userId,
  });
}

export function clearWebSentryUser(): void {
  if (!sentryInitialized) return;
  Sentry.setUser(null);
}

export function addWebSentryBreadcrumb(
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

export function captureWebSentryException(
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
