const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|password|api[_-]?key|credential|prompt|content|stdout|stderr|request_body|body|env|file_path|path|query|search)/i;
const ABSOLUTE_PATH_PATTERN =
  /(?:\/Users\/[^\s<>"')]+|\/home\/[^\s<>"')]+|\/private\/var\/mobile\/[^\s<>"')]+|\/var\/mobile\/[^\s<>"')]+|\/data\/(?:user|data)\/[^\s<>"')]+|(?<![A-Za-z])[A-Za-z]:[\\/][^\s<>"')]+)/g;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/g;
const ABSOLUTE_URL_PATTERN =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"')]+/gi;
const RELATIVE_URL_WITH_QUERY_PATTERN =
  /(^|[\s("'=])((?:\/|\.\/|\.\.\/)[^\s<>"')?#]+)\?([^\s<>"')#]+)(#[^\s<>"')]*)?/g;
const QUERY_SECRET_PATTERN =
  /([?&](?:code|state|access_token|refresh_token|id_token|token|auth|key|secret|password)=)[^&#\s]+/gi;
// The path group must start with `/` so it cannot overlap with the authority
// group's character class; an ambiguous split is polynomial-backtracking bait
// (CodeQL js/polynomial-redos) on adversarial `scheme://"""...` inputs.
const ABSOLUTE_URL_PARTS_PATTERN =
  /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i;
const CIRCULAR_REFERENCE_MARKER = "[circular]";
const TRUNCATION_MARKER = "[truncated]";
const OBJECT_TRUNCATION_KEY = "[truncated]";
const UNINSPECTABLE_VALUE_MARKER = "[redacted]";
// Normal Sentry and PostHog envelopes stay well below this while stack frames
// and nested contexts retain enough headroom for useful diagnostics.
const MAX_SCRUB_DEPTH = 10;
const MAX_SCRUB_ARRAY_ITEMS = 100;
const MAX_SCRUB_OBJECT_PROPERTIES = 100;

export type Scrubbable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Scrubbable[]
  | { [key: string]: unknown };

export interface ScrubTelemetryOptions {
  preservePostHogInternalKeys?: boolean;
}

interface ScrubContext {
  activeObjects: WeakSet<object>;
  scrubbedObjects: WeakMap<object, Scrubbable>;
  options: ScrubTelemetryOptions;
}

export function scrubTelemetryUrl(value: string): string {
  const absoluteMatch = ABSOLUTE_URL_PARTS_PATTERN.exec(value);
  if (absoluteMatch) {
    return `${absoluteMatch[1]}${absoluteMatch[2] || ""}`;
  }

  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    const queryIndex = value.indexOf("?");
    const hashIndex = value.indexOf("#");
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    return cutIndex === undefined ? value : value.slice(0, cutIndex);
  }

  return value.replace(QUERY_SECRET_PATTERN, "$1[redacted]");
}

export function scrubTelemetryText(value: string): string {
  return value
    .replace(ABSOLUTE_URL_PATTERN, (match) => scrubTelemetryUrl(match))
    .replace(RELATIVE_URL_WITH_QUERY_PATTERN, (_match, prefix: string, path: string) => {
      return `${prefix}${path}`;
    })
    .replace(QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(BEARER_TOKEN_PATTERN, "[redacted-token]")
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(ABSOLUTE_PATH_PATTERN, "[redacted-path]");
}

function isPostHogInternalKey(key: string): boolean {
  return key.startsWith("$") || key === "token" || key === "distinct_id" || key === "uuid";
}

function shouldScrubKey(key: string, options: ScrubTelemetryOptions): boolean {
  if (options.preservePostHogInternalKeys && isPostHogInternalKey(key)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERN.test(key);
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function readArrayShape(
  value: object,
): { isArray: false } | { isArray: true; length: number } | null {
  try {
    if (!Array.isArray(value)) {
      return { isArray: false };
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || typeof lengthDescriptor.value !== "number"
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      return null;
    }
    return { isArray: true, length: lengthDescriptor.value };
  } catch {
    return null;
  }
}

function defineScrubbedProperty(target: object, key: string, value: Scrubbable): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function scrubDescriptorValue(
  descriptor: PropertyDescriptor,
  key: string | undefined,
  depth: number,
  context: ScrubContext,
): Scrubbable {
  if (!("value" in descriptor)) {
    return UNINSPECTABLE_VALUE_MARKER;
  }
  return scrubValue(descriptor.value as Scrubbable, key, depth, context);
}

function scrubArrayItems(
  value: object,
  scrubbed: Scrubbable[],
  sourceLength: number,
  depth: number,
  context: ScrubContext,
): void {
  const retainedLength = Math.min(sourceLength, MAX_SCRUB_ARRAY_ITEMS);
  scrubbed.length = retainedLength;
  let truncated = sourceLength > retainedLength;

  try {
    for (let index = 0; index < retainedLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable) {
        continue;
      }
      defineScrubbedProperty(
        scrubbed,
        String(index),
        scrubDescriptorValue(descriptor, undefined, depth + 1, context),
      );
    }
  } catch {
    truncated = true;
  }

  if (truncated) {
    defineScrubbedProperty(scrubbed, String(retainedLength), TRUNCATION_MARKER);
  }
}

function scrubObjectProperties(
  value: object,
  scrubbed: Record<string, Scrubbable>,
  depth: number,
  context: ScrubContext,
): void {
  let inspectedProperties = 0;
  let truncated = false;

  try {
    for (const entryKey in value) {
      if (inspectedProperties >= MAX_SCRUB_OBJECT_PROPERTIES) {
        truncated = true;
        break;
      }
      inspectedProperties += 1;

      const descriptor = Object.getOwnPropertyDescriptor(value, entryKey);
      if (!descriptor?.enumerable) {
        continue;
      }
      defineScrubbedProperty(
        scrubbed,
        entryKey,
        scrubDescriptorValue(descriptor, entryKey, depth + 1, context),
      );
    }
  } catch {
    truncated = true;
  }

  if (truncated) {
    defineScrubbedProperty(scrubbed, OBJECT_TRUNCATION_KEY, TRUNCATION_MARKER);
  }
}

function scrubValue(
  value: Scrubbable,
  key: string | undefined,
  depth: number,
  context: ScrubContext,
): Scrubbable {
  if (value == null) return value;

  if (key && shouldScrubKey(key, context.options)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return scrubTelemetryText(value);
  }

  if (typeof value === "object") {
    if (depth >= MAX_SCRUB_DEPTH) {
      return TRUNCATION_MARKER;
    }

    if (context.activeObjects.has(value)) {
      return CIRCULAR_REFERENCE_MARKER;
    }

    const cached = context.scrubbedObjects.get(value);
    if (cached !== undefined) {
      return cached;
    }

    const shape = readArrayShape(value);
    if (!shape) {
      return UNINSPECTABLE_VALUE_MARKER;
    }

    const scrubbed: Record<string, Scrubbable> | Scrubbable[] = shape.isArray
      ? []
      : {};
    context.scrubbedObjects.set(value, scrubbed);
    context.activeObjects.add(value);

    try {
      if (shape.isArray) {
        scrubArrayItems(value, scrubbed as Scrubbable[], shape.length, depth, context);
      } else {
        scrubObjectProperties(
          value,
          scrubbed as Record<string, Scrubbable>,
          depth,
          context,
        );
      }
    } finally {
      context.activeObjects.delete(value);
    }

    return scrubbed;
  }

  return value;
}

export function scrubTelemetryData<T>(value: T, options: ScrubTelemetryOptions = {}): T {
  return scrubValue(value as Scrubbable, undefined, 0, {
    activeObjects: new WeakSet(),
    scrubbedObjects: new WeakMap(),
    options,
  }) as T;
}

/**
 * Recursively scrub a Sentry event while preserving its top-level
 * `environment` field as bounded deployment identity.
 *
 * The generic recursive scrubber redacts any `environment`/`env` key, which
 * would drop the deployment environment name (e.g. `production`) that support
 * investigation depends on. This wrapper snapshots only the top-level
 * `environment` string, runs the recursive scrubber, then restores the snapshot
 * scrubbed as text. Nested `env`/`environment` fields, raw process-environment
 * maps, and every other sensitive key stay redacted.
 */
export function scrubTelemetryEvent<T>(value: T, options: ScrubTelemetryOptions = {}): T {
  const originalEnvironment = readOwnDataProperty(value, "environment");
  const scrubbed = scrubTelemetryData(value, options);
  if (
    typeof originalEnvironment === "string"
    && scrubbed !== null
    && typeof scrubbed === "object"
  ) {
    defineScrubbedProperty(scrubbed, "environment", scrubTelemetryText(originalEnvironment));
  }
  return scrubbed;
}
