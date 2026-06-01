import {
  NOISY_BOOT_LABEL_PREFIXES,
  type BootDiagnosticEvent,
} from "./boot-stall-diagnostics-types";
import { round } from "./debug-measurement-utils";

export function isLikelyWebKitRuntime(): boolean {
  const userAgent = navigator.userAgent;
  return userAgent.includes("AppleWebKit")
    && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent);
}

export function stackWithoutBootDiagnosticFrames(stack: string): string {
  return stack
    .split("\n")
    .filter((line) =>
      !line.includes("recordLayoutReadInAnimationFrame")
      && !line.includes("bootDiagnosticsGetBoundingClientRect")
    )
    .slice(0, 9)
    .join("\n");
}

export function summarizeFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, unknown> {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return {
    method,
    url: sanitizeBootUrl(input instanceof Request ? input.url : String(input)),
  };
}

export function sanitizeBootUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

export function describeBootElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 5)
    .map((className) => `.${className}`)
    .join("");
  const dataAttributes = [
    "data-chat-transcript-root",
    "data-chat-composer-footer",
    "data-chat-composer-surface",
    "data-code",
    "data-file",
    "data-file-source-virtualized",
    "data-index",
    "data-transcript-virtual-row",
  ]
    .flatMap((name) => {
      const value = element.getAttribute(name);
      return value === null ? [] : [`[${name}=${JSON.stringify(value)}]`];
    })
    .join("");
  return `${tagName}${id}${classes}${dataAttributes}`.slice(0, 500);
}

export function sanitizeBootMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 12)) {
    sanitized[key] = summarizeBootValue(item);
  }
  return sanitized;
}

export function summarizeBootValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.slice(0, 1_000) ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(summarizeBootValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 10)
        .map(([key, item]) => [key, summarizeBootValue(item)]),
    );
  }

  return String(value);
}

export function formatEventLine(event: BootDiagnosticEvent): string {
  if (!event.metadata || Object.keys(event.metadata).length === 0) {
    return event.label;
  }

  return `${event.label} ${JSON.stringify(event.metadata)}`;
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${round(value / 1024)} KB`;
  }
  return `${round(value / (1024 * 1024))} MB`;
}

export function currentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function isNoisyBootLabel(label: string): boolean {
  return NOISY_BOOT_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}
