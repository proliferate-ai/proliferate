const SECRET_KEY_PATTERN = /(token|key|secret|password|authorization|credential|cookie)/i;
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._\-/+=]+/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_\-+/=]{48,}\b/g;
const SIGNED_URL_PATTERN =
  /([?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|token|key|secret)=)[^&#\s]+/gi;

export function sanitizeSupportUploadPayload<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown, keyHint = ""): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return SECRET_KEY_PATTERN.test(keyHint) ? "[REDACTED]" : sanitizeString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, keyHint));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeValue(item, key);
  }
  return output;
}

function sanitizeString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SIGNED_URL_PATTERN, "$1[REDACTED]")
    .replace(LONG_TOKEN_PATTERN, "[REDACTED]");
}
