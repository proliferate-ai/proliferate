import * as React from "react";
import * as Sentry from "@sentry/react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
  Routes,
} from "react-router-dom";
import type { SeverityLevel } from "@sentry/react";
import { getDesktopTelemetryConfig } from "./config";
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTelemetryData,
} from "./scrub";

const config = getDesktopTelemetryConfig();
const InstrumentedRoutes = Sentry.withSentryReactRouterV7Routing(Routes);

let sentryInitialized = false;

function buildTracePropagationTargets(): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [
    "localhost",
    "127.0.0.1",
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  ];

  const cloudApiBaseUrl = import.meta.env.VITE_PROLIFERATE_API_BASE_URL?.trim();
  if (cloudApiBaseUrl) {
    targets.push(cloudApiBaseUrl);
  }

  return targets;
}

export function initializeDesktopSentry(): void {
  if (sentryInitialized) return;
  sentryInitialized = true;

  if (config.disabled || !config.sentry.enabled || !config.sentry.dsn) {
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.environment,
    release: config.release,
    attachStacktrace: true,
    maxBreadcrumbs: 100,
    sendDefaultPii: false,
    enableLogs: config.sentry.enableLogs,
    tracesSampleRate: config.sentry.tracesSampleRate,
    tracePropagationTargets: buildTracePropagationTargets(),
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
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: scrubSentryBreadcrumb,
    initialScope: {
      tags: {
        surface: "desktop_renderer",
      },
    },
  });
}

export function getDesktopRootErrorHandlers() {
  return {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  };
}

export function setDesktopSentryUser(user: {
  id: string;
  email: string;
  display_name: string | null;
}): void {
  if (config.disabled || !config.sentry.enabled) return;

  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.display_name ?? undefined,
  });
}

export function clearDesktopSentryUser(): void {
  if (config.disabled || !config.sentry.enabled) return;
  Sentry.setUser(null);
}

export function setDesktopSentryTag(key: string, value: string): void {
  if (config.disabled || !config.sentry.enabled) return;
  Sentry.setTag(key, value);
}

export function addDesktopSentryBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (config.disabled || !config.sentry.enabled) return;

  Sentry.addBreadcrumb({
    category: "product",
    message,
    data: scrubTelemetryData(data),
    level: "info",
  });
}

export function captureDesktopSentryException(
  error: unknown,
  context?: {
    level?: SeverityLevel;
    tags?: Record<string, string>;
    extras?: Record<string, unknown>;
    fingerprint?: string[];
  },
): void {
  if (config.disabled || !config.sentry.enabled) return;

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

export { InstrumentedRoutes };
