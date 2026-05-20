import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import {
  scrubTelemetryData as scrubSharedTelemetryData,
  scrubTelemetryText,
} from "@proliferate/product-model/telemetry/scrub";
import type { CaptureResult } from "posthog-js/lib/src/types";

export function scrubTelemetryData<T>(value: T): T {
  return scrubSharedTelemetryData(value);
}

export function scrubSentryBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  return {
    ...breadcrumb,
    message: breadcrumb.message ? scrubTelemetryText(breadcrumb.message) : breadcrumb.message,
    data: scrubTelemetryData(breadcrumb.data),
  };
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
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

function scrubPostHogProperties<T>(value: T): T {
  return scrubSharedTelemetryData(value, { preservePostHogInternalKeys: true });
}

export function scrubPostHogPayload(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event) return event;

  return {
    ...event,
    properties: scrubPostHogProperties(event.properties),
    $set: scrubPostHogProperties(event.$set),
    $set_once: scrubPostHogProperties(event.$set_once),
  };
}
