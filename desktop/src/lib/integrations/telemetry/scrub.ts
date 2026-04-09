import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import type { CaptureResult } from "posthog-js/lib/src/types";

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|password|api[_-]?key|credential|prompt|content|stdout|stderr|request_body|body|env|file_path|path)/i;
const ABSOLUTE_PATH_PATTERN =
  /(?:\/Users\/[^\s]+|\/home\/[^\s]+|[A-Za-z]:\\[^\s]+)/g;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/g;

type Scrubbable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Scrubbable[]
  | { [key: string]: unknown };

function scrubString(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, "[redacted-token]")
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(ABSOLUTE_PATH_PATTERN, "[redacted-path]");
}

function isPostHogInternalKey(key: string): boolean {
  return key.startsWith("$") || key === "token" || key === "distinct_id" || key === "uuid";
}

function scrubValue(value: Scrubbable, key?: string, preservePostHogKeys = false): Scrubbable {
  if (value == null) return value;

  if (key && !(preservePostHogKeys && isPostHogInternalKey(key)) && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return scrubString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, undefined, preservePostHogKeys));
  }

  if (typeof value === "object") {
    const scrubbed: Record<string, Scrubbable> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      scrubbed[entryKey] = scrubValue(entryValue as Scrubbable, entryKey, preservePostHogKeys);
    }
    return scrubbed;
  }

  return value;
}

export function scrubTelemetryData<T>(value: T): T {
  return scrubValue(value as Scrubbable) as T;
}

export function scrubSentryBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  return {
    ...breadcrumb,
    message: breadcrumb.message ? scrubString(breadcrumb.message) : breadcrumb.message,
    data: scrubTelemetryData(breadcrumb.data),
  };
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  const scrubbed: ErrorEvent = {
    ...event,
    message: event.message ? scrubString(event.message) : event.message,
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
      url: scrubbed.request.url ? scrubString(scrubbed.request.url) : scrubbed.request.url,
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
  return scrubValue(value as Scrubbable, undefined, true) as T;
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
