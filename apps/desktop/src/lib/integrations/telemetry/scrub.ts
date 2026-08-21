import type * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import {
  scrubTelemetryData as scrubSharedTelemetryData,
  scrubTelemetryEvent as scrubSharedTelemetryEvent,
  scrubTelemetryText,
} from "@proliferate/product-client/internal/domain/telemetry/scrub";
import {
  redactRouteIdentifiersInCapture,
} from "@proliferate/product-client/internal/domain/telemetry/route-id-redaction";
import type { CaptureResult } from "posthog-js/lib/src/types";

export function scrubTelemetryData<T>(value: T): T {
  return scrubSharedTelemetryData(value);
}

export function scrubSentryBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  const scrubbed = scrubTelemetryData(breadcrumb);
  scrubbed.message = typeof scrubbed.message === "string"
    ? scrubTelemetryText(scrubbed.message)
    : scrubbed.message;
  return scrubbed;
}

type SentryStackFrame = {
  filename?: string;
  abs_path?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: unknown;
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

function scrubSentryFrame(frame: SentryStackFrame): SentryStackFrame {
  return {
    ...frame,
    filename: frame.filename ? scrubTelemetryText(frame.filename) : frame.filename,
    abs_path: frame.abs_path ? scrubTelemetryText(frame.abs_path) : frame.abs_path,
    context_line: undefined,
    pre_context: undefined,
    post_context: undefined,
    vars: undefined,
  };
}

function scrubSentryException(exception: SentryExceptionValue): SentryExceptionValue {
  return {
    ...exception,
    value: exception.value ? scrubTelemetryText(exception.value) : exception.value,
    stacktrace: exception.stacktrace
      ? {
        ...exception.stacktrace,
        frames: exception.stacktrace.frames?.map(scrubSentryFrame),
      }
      : exception.stacktrace,
    raw_stacktrace: exception.raw_stacktrace
      ? {
        ...exception.raw_stacktrace,
        frames: exception.raw_stacktrace.frames?.map(scrubSentryFrame),
      }
      : exception.raw_stacktrace,
  };
}

export function scrubSentrySpan<T extends SentrySpanPayload>(span: T): T {
  const scrubbed = scrubTelemetryData(span) as T;
  if (typeof scrubbed.description === "string") {
    scrubbed.description = scrubTelemetryText(scrubbed.description);
  }
  return scrubbed;
}

type SentryEventPayload = {
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

function scrubSentryEventPayload(event: SentryEventPayload): SentryEventPayload {
  const scrubbed = scrubSharedTelemetryEvent(event);
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
    scrubbed.exception.values = scrubbed.exception.values.map(scrubSentryException);
  }

  if (scrubbed.spans) {
    scrubbed.spans = scrubbed.spans.map(scrubSentrySpan);
  }

  return scrubbed;
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubSentryEventPayload(event as unknown as SentryEventPayload) as unknown as ErrorEvent;
}

export function scrubSentryTransaction(
  event: SentryTransactionEvent,
): SentryTransactionEvent | null {
  return scrubSentryEventPayload(
    event as unknown as SentryEventPayload,
  ) as unknown as SentryTransactionEvent;
}

function scrubPostHogProperties<T>(value: T): T {
  return scrubSharedTelemetryData(value, { preservePostHogInternalKeys: true });
}

/**
 * The single `before_send` for Desktop PostHog. Two passes, in order:
 *
 * 1. the shared scrubber, which removes sensitive keys and secret-shaped text;
 * 2. route-identifier redaction, which reduces every URL and every rrweb
 *    `href`/`src` to a bounded route template.
 *
 * Pass 2 is not redundant. The shared scrubber exempts `$`-prefixed PostHog
 * keys from key redaction and `scrubTelemetryUrl` deliberately keeps the URL
 * path, so `$current_url` and the rrweb Meta event `href` reach the provider
 * with `/workflows/<id>` intact without it. See
 * `product-client/src/domain/telemetry/route-id-redaction.ts`.
 *
 * The replay stream is deliberately held out of pass 1. The shared scrubber
 * bounds container depth, array positions, and object properties, so a real
 * rrweb DOM snapshot would come back as `[truncated]` markers rather than a
 * playable recording. Pass 2 owns that stream instead: it walks it without a
 * depth cap and rewrites only URL-bearing and content-bearing fields. rrweb
 * text and input content is controlled by the recorder's masking
 * configuration, not by this scrubber.
 */
export function scrubPostHogPayload(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event) return event;

  const snapshotData = event.properties?.$snapshot_data;
  if (snapshotData === undefined) {
    return redactRouteIdentifiersInCapture(scrubPostHogProperties(event));
  }

  const { $snapshot_data: heldStream, ...restProperties } = event.properties;
  const scrubbed = scrubPostHogProperties({ ...event, properties: restProperties });
  return redactRouteIdentifiersInCapture({
    ...scrubbed,
    properties: { ...scrubbed.properties, $snapshot_data: heldStream },
  });
}
