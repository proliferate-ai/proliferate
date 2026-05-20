import * as React from "react";
import * as Sentry from "@sentry/react";
import {
  createRoutesFromChildren,
  matchRoutes,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import type {
  Breadcrumb,
  ErrorEvent,
  SeverityLevel,
} from "@sentry/react";
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

type SentryStackFrame = {
  filename?: string;
  abs_path?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: Record<string, unknown>;
};

type SentryExceptionValue = {
  value?: string;
  stacktrace?: { frames?: SentryStackFrame[] };
  raw_stacktrace?: { frames?: SentryStackFrame[] };
};

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryTransactionEvent = Parameters<
  NonNullable<SentryInitOptions["beforeSendTransaction"]>
>[0];
type SentrySpanPayload = Parameters<NonNullable<SentryInitOptions["beforeSendSpan"]>>[0];
type MutableSentryEvent = {
  breadcrumbs?: Breadcrumb[];
  exception?: { values?: SentryExceptionValue[] };
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    url?: string;
    [key: string]: unknown;
  };
  spans?: SentrySpanPayload[];
  transaction?: string;
  user?: {
    id?: string;
    [key: string]: unknown;
  };
};

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

function scrubSentryFrame(frame: SentryStackFrame): void {
  frame.filename = frame.filename ? scrubTelemetryText(frame.filename) : frame.filename;
  frame.abs_path = frame.abs_path ? scrubTelemetryText(frame.abs_path) : frame.abs_path;
  frame.context_line = undefined;
  frame.pre_context = undefined;
  frame.post_context = undefined;
  frame.vars = undefined;
}

function scrubSentryException(exception: SentryExceptionValue): void {
  exception.value = exception.value ? scrubTelemetryText(exception.value) : exception.value;
  exception.stacktrace?.frames?.forEach(scrubSentryFrame);
  exception.raw_stacktrace?.frames?.forEach(scrubSentryFrame);
}

function scrubSentrySpan<T extends SentrySpanPayload>(span: T): T {
  const scrubbed = scrubTelemetryData(span) as T;
  if (typeof scrubbed.description === "string") {
    scrubbed.description = scrubTelemetryText(scrubbed.description);
  }
  return scrubbed;
}

function scrubSentryEventPayload(event: MutableSentryEvent): MutableSentryEvent {
  const scrubbed = scrubTelemetryData(event);
  scrubbed.transaction = scrubbed.transaction
    ? scrubTelemetryText(scrubbed.transaction)
    : scrubbed.transaction;

  if (scrubbed.user) {
    scrubbed.user = scrubbed.user.id ? { id: scrubbed.user.id } : undefined;
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

  if (scrubbed.exception?.values) {
    (scrubbed.exception.values as unknown as SentryExceptionValue[]).forEach(
      scrubSentryException,
    );
  }

  if (scrubbed.spans) {
    scrubbed.spans = scrubbed.spans.map(scrubSentrySpan);
  }

  return scrubbed;
}

function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubSentryEventPayload(event as unknown as MutableSentryEvent) as unknown as ErrorEvent;
}

function scrubSentryTransaction(
  event: SentryTransactionEvent,
): SentryTransactionEvent | null {
  return scrubSentryEventPayload(
    event as unknown as MutableSentryEvent,
  ) as unknown as SentryTransactionEvent;
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
    beforeSendTransaction: scrubSentryTransaction,
    beforeSendSpan: (span) => scrubSentrySpan(span),
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
