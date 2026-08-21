/**
 * Route-identifier redaction for PostHog payloads.
 *
 * Why this exists: PostHog attaches the live page URL to *every* captured
 * event (`$current_url`, `$pathname`, `$session_entry_url`, `$initial_*`, and
 * more added by future SDK versions), and session replay additionally carries
 * the URL inside the rrweb stream (`$snapshot_data`) as the Meta event `href`
 * and as `href`/`src` attributes on serialized DOM nodes. Several product
 * routes embed opaque resource identifiers in the path
 * (`/workflows/<workflowId>/runs/<runId>`, `/workspaces/<workspaceId>`), so
 * those identifiers reach the provider verbatim unless the path itself is
 * reduced.
 *
 * The shared scrubber in `./scrub` cannot do this job. `scrubTelemetryUrl`
 * deliberately keeps the path and only strips query/hash, and
 * `preservePostHogInternalKeys` exempts every `$`-prefixed key from
 * key-based redaction, so it is a no-op for exactly this class. Its depth,
 * array, and property caps would also shred an rrweb DOM snapshot into
 * `[truncated]` markers rather than redact it.
 *
 * The policy here is allowlist-shaped, not pattern-shaped: a pathname is
 * matched against a closed table of bounded route templates and replaced by
 * the template it matched. A path that matches nothing becomes
 * `UNKNOWN_BOUNDED_ROUTE`. Nothing that was not already a literal in this
 * file can survive the reduction, so a new id-bearing route added tomorrow
 * fails closed to `/unknown` instead of leaking.
 */

import { scrubTelemetryText } from "./scrub";

/** Emitted for any pathname that does not match a bounded route template. */
export const UNKNOWN_BOUNDED_ROUTE = "/unknown";

/** Emitted for a URL-valued attribute that cannot be reduced to a bounded route. */
export const REDACTED_URL = "[redacted-url]";

/**
 * Closed table of client route templates. Segments beginning with `:` match
 * exactly one path segment and are emitted as the placeholder itself, so the
 * identifier value never survives. Keep this sorted by specificity within a
 * prefix; matching is exact on segment count so ordering is not load bearing.
 *
 * Sources: `src/pages/AuthenticatedAppHost.tsx`, `src/App.tsx`,
 * `apps/web/src/WebHostApp.tsx`, and the bounded route vocabulary in
 * `src/lib/domain/telemetry/routes.ts`. Development-only `/playground/*`
 * routes are deliberately absent: they fail closed to `/unknown`.
 */
export const BOUNDED_ROUTE_TEMPLATES: readonly string[] = [
  "/",
  "/index.html",
  "/login",
  "/login/:slug",
  "/auth/callback",
  "/auth/error",
  "/join/:orgId",
  "/plugins",
  "/plugins/connect/complete",
  "/integrations",
  "/settings",
  "/settings/cloud",
  "/settings/billing",
  "/setup",
  "/workflows",
  "/workflows/:workflowId",
  "/workflows/:workflowId/runs/:runId",
  "/automations",
  "/automations/:workflowId",
  "/workspaces",
  "/workspaces/:workspaceId",
];

/**
 * Names whose value is a URL by definition. These fail closed: a value that
 * cannot be reduced to a bounded route becomes `REDACTED_URL` rather than
 * being passed through.
 *
 * The DOM attributes cover serialized nodes inside a full snapshot; `href`
 * additionally covers the rrweb Meta event (`{ type: 4, data: { href } }`),
 * which is where the recorded page URL actually lives. `currenturl`,
 * `pathname`, `url`, and `initiatorurl` cover PostHog's own custom rrweb
 * events and network-capture payloads.
 */
const URL_VALUED_NAMES = new Set([
  "action",
  "background",
  "cite",
  "currenturl",
  "data",
  "formaction",
  "href",
  "initiatorurl",
  "longdesc",
  "pathname",
  "ping",
  "poster",
  "src",
  "srcset",
  "url",
  "usemap",
  "xlink:href",
]);

/**
 * rrweb keys that *may* hold a URL. They are reduced when the value looks like
 * one and passed through otherwise, because they also legitimately hold plain
 * text (`name` is both a form-control attribute and the request URL on a
 * captured network entry).
 */
const RRWEB_SOFT_URL_KEYS = new Set(["name"]);

/**
 * Serialized attributes that carry human-readable content and are *not*
 * covered by the recorder's text masking, which only masks text nodes and
 * input values. These get the shared text scrubber, so an absolute filesystem
 * path or a token that reached a tooltip or label is redacted.
 */
const RRWEB_CONTENT_KEYS = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-valuetext",
  "content",
  "download",
  "placeholder",
  "title",
  "value",
]);

/**
 * Schemes whose values carry inline or opaque content rather than a route
 * path, so reducing them would cost replay fidelity for no privacy gain.
 */
const NON_ROUTE_SCHEME_PATTERN = /^(?:data|blob|mailto|tel|javascript|about):/i;

/**
 * Splits `scheme://authority` from the path. The path group must start with
 * `/` so it cannot overlap the authority group, matching the anti-backtracking
 * shape already used in `./scrub`.
 */
const ABSOLUTE_URL_PARTS_PATTERN =
  /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(\/[^?#]*)?(?:[?#].*)?$/i;

/**
 * Upper bound on values visited while redacting a single capture. A real full
 * DOM snapshot is tens of thousands of nodes; this is an order of magnitude
 * above that. Exceeding it means the payload is not the shape this module
 * understands, so the capture is dropped rather than forwarded unredacted.
 */
export const MAX_REDACTION_VISITS = 250_000;

interface RedactionBudget {
  remaining: number;
}

export interface CaptureLike {
  properties?: Record<string, unknown> | undefined;
  $set?: Record<string, unknown> | undefined;
  $set_once?: Record<string, unknown> | undefined;
}

function splitPathSegments(pathname: string): string[] {
  const segments = pathname.split("/");
  // A leading `/` yields an empty first segment, and a trailing `/` yields an
  // empty last one. Both are path punctuation, not content.
  if (segments.length > 0 && segments[0] === "") segments.shift();
  if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
  return segments;
}

function templateMatches(templateSegments: string[], pathSegments: string[]): boolean {
  if (templateSegments.length !== pathSegments.length) return false;
  for (let index = 0; index < templateSegments.length; index += 1) {
    const templateSegment = templateSegments[index];
    if (templateSegment.startsWith(":")) {
      // A parameter must consume exactly one non-empty segment.
      if (pathSegments[index].length === 0) return false;
      continue;
    }
    // React Router matches path literals case-insensitively.
    if (templateSegment !== pathSegments[index].toLowerCase()) return false;
  }
  return true;
}

/**
 * Reduce a pathname to the bounded route template it matched, or
 * `UNKNOWN_BOUNDED_ROUTE` when it matched nothing.
 */
export function boundRoutePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0];
  const pathSegments = splitPathSegments(withoutQuery);
  if (pathSegments.length === 0) return "/";

  for (const template of BOUNDED_ROUTE_TEMPLATES) {
    if (templateMatches(splitPathSegments(template), pathSegments)) {
      return template;
    }
  }
  return UNKNOWN_BOUNDED_ROUTE;
}

/**
 * Reduce a URL to `origin + bounded route`, dropping query and fragment.
 * Returns `null` when the value is not a URL or path this module can bound,
 * which lets callers decide between passing the value through (free text) and
 * failing closed (a URL-valued attribute).
 */
export function boundRouteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const absolute = ABSOLUTE_URL_PARTS_PATTERN.exec(trimmed);
  if (absolute) {
    return `${absolute[1]}${boundRoutePathname(absolute[2] ?? "/")}`;
  }

  if (trimmed.startsWith("/")) {
    return boundRoutePathname(trimmed);
  }

  return null;
}

/**
 * Redact a free-text value: reduce it when it is a URL or absolute path, and
 * otherwise return it unchanged. Used for event property values, where most
 * strings are not URLs and must survive intact.
 */
export function redactRouteIdentifiersInText(value: string): string {
  return boundRouteUrl(value) ?? value;
}

/**
 * Redact one serialized DOM attribute.
 *
 * Called from two places, and only one of them runs today. The capture
 * boundary (`before_send` -> `redactRouteIdentifiersInCapture`) reaches every
 * attribute inside `$snapshot_data` and is what actually closes the leak. It
 * is also wired as posthog-js `session_recording.maskAttributeFn`, which the
 * pinned `posthog-js@1.386.8` never invokes: the option is declared by the
 * newer transitive `@posthog/types@1.404.1` but the SDK forwards only
 * `maskAllInputs`, `maskTextSelector`, and `blockSelector` to rrweb. Treat the
 * recorder boundary as dormant forward-compatibility, never as coverage.
 */
export function redactRouteIdentifiersInAttribute(name: string, value: string): string {
  const normalizedName = name.toLowerCase();
  if (!URL_VALUED_NAMES.has(normalizedName)) {
    return redactRouteIdentifiersInText(value);
  }

  const trimmed = value.trim();
  // In-page fragments and inline/opaque schemes carry no route path.
  if (trimmed.startsWith("#")) return value;
  if (NON_ROUTE_SCHEME_PATTERN.test(trimmed)) return value;

  return boundRouteUrl(trimmed) ?? REDACTED_URL;
}

function redactRrwebValue(value: unknown, key: string | undefined, budget: RedactionBudget): unknown {
  budget.remaining -= 1;
  if (budget.remaining < 0) return value;

  if (typeof value === "string") {
    // Only URL-bearing rrweb keys are rewritten. Text nodes are already masked
    // by the recorder's masking configuration, and rewriting arbitrary strings
    // here would corrupt the replay without adding privacy.
    if (key === undefined) return value;
    const normalizedKey = key.toLowerCase();
    if (URL_VALUED_NAMES.has(normalizedKey)) {
      return redactRouteIdentifiersInAttribute(key, value);
    }
    if (RRWEB_SOFT_URL_KEYS.has(normalizedKey)) {
      return redactRouteIdentifiersInText(value);
    }
    if (RRWEB_CONTENT_KEYS.has(normalizedKey)) {
      return redactRouteIdentifiersInText(scrubTelemetryText(value));
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactRrwebValue(entry, undefined, budget));
  }

  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      redacted[entryKey] = redactRrwebValue(entryValue, entryKey, budget);
    }
    return redacted;
  }

  return value;
}

function redactPropertyValue(value: unknown, budget: RedactionBudget): unknown {
  budget.remaining -= 1;
  if (budget.remaining < 0) return value;

  if (typeof value === "string") return redactRouteIdentifiersInText(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactPropertyValue(entry, budget));
  }

  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      redacted[entryKey] = redactPropertyValue(entryValue, budget);
    }
    return redacted;
  }

  return value;
}

/**
 * Redact route identifiers out of a PostHog capture, in place of the payload
 * that would otherwise be transmitted. Applies to every event, not only
 * `$snapshot`: ordinary product events carry the same `$current_url` and
 * `$pathname` properties.
 *
 * Returns `null` when the payload exceeds `MAX_REDACTION_VISITS`, which drops
 * the capture. posthog-js treats a `null` from `before_send` as a rejected
 * event (`posthog-core.ts` `_runBeforeSend`), so an unrecognisably large
 * payload is discarded rather than sent unredacted.
 */
export function redactRouteIdentifiersInCapture<T extends CaptureLike>(
  event: T | null,
): T | null {
  if (!event) return event;

  const budget: RedactionBudget = { remaining: MAX_REDACTION_VISITS };
  const redacted = { ...event } as T & Record<string, unknown>;

  if (event.properties) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.properties)) {
      properties[key] = key === "$snapshot_data"
        ? redactRrwebValue(value, undefined, budget)
        : redactPropertyValue(value, budget);
    }
    redacted.properties = properties;
  }

  // `$set` and `$set_once` are siblings of `properties` on a PostHog capture,
  // and `$set_once.$initial_current_url` carries the entry URL.
  for (const personKey of ["$set", "$set_once"] as const) {
    const personProperties = event[personKey];
    if (personProperties) {
      redacted[personKey] = redactPropertyValue(personProperties, budget) as Record<
        string,
        unknown
      >;
    }
  }

  if (budget.remaining < 0) return null;

  return redacted;
}
