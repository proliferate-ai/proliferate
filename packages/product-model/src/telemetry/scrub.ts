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
const ABSOLUTE_URL_PARTS_PATTERN =
  /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)(?:[?#].*)?$/i;

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

function scrubValue(
  value: Scrubbable,
  key: string | undefined,
  options: ScrubTelemetryOptions,
): Scrubbable {
  if (value == null) return value;

  if (key && shouldScrubKey(key, options)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return scrubTelemetryText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, undefined, options));
  }

  if (typeof value === "object") {
    const scrubbed: Record<string, Scrubbable> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      scrubbed[entryKey] = scrubValue(entryValue as Scrubbable, entryKey, options);
    }
    return scrubbed;
  }

  return value;
}

export function scrubTelemetryData<T>(value: T, options: ScrubTelemetryOptions = {}): T {
  return scrubValue(value as Scrubbable, undefined, options) as T;
}
