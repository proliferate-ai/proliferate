import * as React from "react";
import * as Sentry from "@sentry/react";
import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js/lib/src/types";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import {
  scrubTelemetryData,
  scrubTelemetryEvent,
  scrubTelemetryText,
} from "@proliferate/product-domain/telemetry/scrub";

import { webEnv } from "../../config/env";
import { shouldDropExpectedWebSentryEvent } from "./sentry-event-filter";

/**
 * The Web host's vendor-telemetry bootstrap: it initializes Sentry and PostHog
 * at process start, before the shared product mounts. It is the reduced remnant
 * of the deleted `lib/integrations/telemetry/{config,sentry,posthog}` modules —
 * only the vendor lifecycle (init + PII scrubbing + React root error handlers)
 * survives here. Route classification, screen-view events, and user identity are
 * now owned by ProductClient and flow through the `host.telemetry` adapter in
 * `web-telemetry.ts`; none of that lives here.
 */

// Injected by apps/web/vite.config.ts from the repo-root VERSION file. Only used
// for the local-dev release fallback below; real builds set
// VITE_PROLIFERATE_RELEASE directly (see vercel.json).
declare const __PROLIFERATE_WEB_VERSION__: string;

interface WebTelemetryConfig {
  environment: string;
  release: string;
  sentry: {
    enabled: boolean;
    dsn: string | null;
    tracesSampleRate: number;
    enableLogs: boolean;
  };
  posthog: {
    enabled: boolean;
    apiKey: string | null;
    apiHost: string;
    sessionRecordingEnabled: boolean;
  };
}

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function envFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function getWebTelemetryConfig(): WebTelemetryConfig {
  const sentryDsn = import.meta.env.VITE_PROLIFERATE_SENTRY_DSN?.trim() || null;
  const posthogKey = import.meta.env.VITE_PROLIFERATE_POSTHOG_KEY?.trim() || null;
  const telemetryDisabled = envFlagEnabled(
    import.meta.env.VITE_PROLIFERATE_TELEMETRY_DISABLED,
    false,
  );

  return {
    environment:
      import.meta.env.VITE_PROLIFERATE_ENVIRONMENT?.trim()
      || (import.meta.env.DEV ? "development" : "production"),
    release:
      import.meta.env.VITE_PROLIFERATE_RELEASE?.trim()
      // Local dev only: Vercel builds always set VITE_PROLIFERATE_RELEASE to the
      // canonical `proliferate-web@<VERSION>+<12-hex-sha>` string. This fallback
      // carries a `-dev` marker rejected by the server's release parser so it
      // cannot masquerade as a real release.
      || `proliferate-web@${__PROLIFERATE_WEB_VERSION__}-dev`,
    sentry: {
      enabled: !telemetryDisabled && sentryDsn !== null,
      dsn: sentryDsn,
      tracesSampleRate: envFloat(
        import.meta.env.VITE_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE,
        1.0,
      ),
      enableLogs: envFlagEnabled(
        import.meta.env.VITE_PROLIFERATE_SENTRY_ENABLE_LOGS,
        true,
      ),
    },
    posthog: {
      enabled: !telemetryDisabled && posthogKey !== null,
      apiKey: posthogKey,
      apiHost:
        import.meta.env.VITE_PROLIFERATE_POSTHOG_HOST?.trim()
        || "https://us.i.posthog.com",
      sessionRecordingEnabled: envFlagEnabled(
        import.meta.env.VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED,
        false,
      ),
    },
  };
}

// --- Sentry vendor init ------------------------------------------------------

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
  const scrubbed = scrubTelemetryData(breadcrumb);
  scrubbed.message = typeof scrubbed.message === "string"
    ? scrubTelemetryText(scrubbed.message)
    : scrubbed.message;
  return scrubbed;
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
  const scrubbed = scrubTelemetryEvent(event);
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

function scrubSentryEvent(
  event: ErrorEvent,
  hint: Parameters<NonNullable<SentryInitOptions["beforeSend"]>>[1],
): ErrorEvent | null {
  if (shouldDropExpectedWebSentryEvent(event, hint)) {
    return null;
  }
  return scrubSentryEventPayload(event as unknown as MutableSentryEvent) as unknown as ErrorEvent;
}

function scrubSentryTransaction(
  event: SentryTransactionEvent,
): SentryTransactionEvent | null {
  return scrubSentryEventPayload(
    event as unknown as MutableSentryEvent,
  ) as unknown as SentryTransactionEvent;
}

function initializeWebSentry(config: WebTelemetryConfig, apiBaseUrl: string): void {
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
    tracePropagationTargets: buildTracePropagationTargets(apiBaseUrl),
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

// --- PostHog vendor init -----------------------------------------------------

const POSTHOG_URL_PROPERTY_KEYS = [
  "$current_url",
  "$pathname",
  "$host",
  "$referrer",
  "$referring_domain",
];

function scrubPostHogCapture(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  const scrubbed = scrubTelemetryData(event, { preservePostHogInternalKeys: true });
  if (scrubbed.properties) {
    for (const key of POSTHOG_URL_PROPERTY_KEYS) {
      delete scrubbed.properties[key];
    }
  }
  return scrubbed;
}

function initializeWebPostHog(config: WebTelemetryConfig): void {
  if (!config.posthog.enabled || !config.posthog.apiKey) {
    return;
  }
  posthog.init(config.posthog.apiKey, {
    api_host: config.posthog.apiHost,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    person_profiles: "identified_only",
    before_send: scrubPostHogCapture,
    disable_session_recording: !config.posthog.sessionRecordingEnabled,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-telemetry-mask]",
      blockSelector: "[data-telemetry-block]",
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: () => null,
    },
  });
  posthog.register({
    app: "proliferate-web",
    surface: "web",
    environment: config.environment,
    release: config.release,
  });
}

// --- Public bootstrap --------------------------------------------------------

/**
 * React 19 root error handlers wired to Sentry. Empty (default React behavior)
 * until Sentry is initialized, so a telemetry-disabled build stays inert.
 */
export type WebRootErrorHandlers = Partial<{
  onUncaughtError: (error: unknown, errorInfo: React.ErrorInfo) => void;
  onCaughtError: (error: unknown, errorInfo: React.ErrorInfo) => void;
  onRecoverableError: (error: unknown, errorInfo: React.ErrorInfo) => void;
}>;

/**
 * Initialize both vendor telemetry clients at process start and return the
 * React root error handlers. Idempotent: safe against a double-invoke. Both
 * clients no-op when telemetry is disabled or unconfigured.
 */
export function installWebTelemetry(): WebRootErrorHandlers {
  const config = getWebTelemetryConfig();
  initializeWebSentry(config, webEnv.apiBaseUrl);
  initializeWebPostHog(config);

  if (!sentryInitialized) {
    return {};
  }
  return {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  };
}
