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
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTelemetryData,
} from "./scrub";
import type { DesktopTelemetryConfig } from "./config";

const InstrumentedRoutes = Sentry.withSentryReactRouterV7Routing(Routes);

let sentryInitialized = false;

function buildTracePropagationTargets(apiBaseUrl: string): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [
    "localhost",
    "127.0.0.1",
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  ];

  if (apiBaseUrl.trim()) {
    targets.push(apiBaseUrl.trim());
  }

  return targets;
}

interface DesktopSentryInitConfig {
  environment: string;
  release: string;
  sentry: DesktopTelemetryConfig["sentry"];
  apiBaseUrl: string;
  telemetryMode: "local_dev" | "self_managed" | "hosted_product";
}

export function initializeDesktopSentry(config: DesktopSentryInitConfig): void {
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
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: scrubSentryBreadcrumb,
    initialScope: {
      tags: {
        surface: "desktop_renderer",
        telemetry_mode: config.telemetryMode,
      },
    },
  });
}

export function getDesktopRootErrorHandlers() {
  if (!sentryInitialized) {
    return {};
  }

  return {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  };
}

export function setDesktopSentryUser(userId: string): void {
  if (!sentryInitialized) return;

  Sentry.setUser({
    id: userId,
  });
}

export function clearDesktopSentryUser(): void {
  if (!sentryInitialized) return;
  Sentry.setUser(null);
}

export function setDesktopSentryTag(key: string, value: string): void {
  if (!sentryInitialized) return;
  Sentry.setTag(key, value);
}

export function addDesktopSentryBreadcrumb(
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

export function captureDesktopSentryException(
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

export { InstrumentedRoutes };
