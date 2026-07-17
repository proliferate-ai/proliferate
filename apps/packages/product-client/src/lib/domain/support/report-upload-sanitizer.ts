const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._\-/+=]+/gi;
const ENV_SECRET_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|COOKIE)[A-Z0-9_]*\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/gi;
const LONG_TOKEN_PATTERN =
  /(^|[^A-Za-z0-9_\-+/=])([A-Za-z0-9_\-+/=]{48,})(?=$|[^A-Za-z0-9_\-+/=])/g;
const SIGNED_URL_PATTERN =
  /([?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|token|key|secret)=)[^&#\s]+/gi;
const MAX_LOG_TEXT_CHARS = 2 * 1024 * 1024;
const OMITTED_INCOMPLETE_LOG_TAIL = "[truncated log tail omitted]";

export function sanitizeSupportLogText(value: unknown): string {
  if (typeof value !== "string") {
    return "[redacted]";
  }
  const boundedValue = boundedLogTail(value);
  return boundedValue
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(ENV_SECRET_PATTERN, "$1[REDACTED]")
    .replace(SIGNED_URL_PATTERN, "$1[REDACTED]")
    .replace(LONG_TOKEN_PATTERN, "$1[REDACTED]");
}

function boundedLogTail(value: string): string {
  if (value.length <= MAX_LOG_TEXT_CHARS) {
    return value;
  }
  const tail = String.prototype.slice.call(value, -MAX_LOG_TEXT_CHARS) as string;
  const firstLineEnd = tail.indexOf("\n");
  return firstLineEnd >= 0
    ? tail.slice(firstLineEnd + 1)
    : OMITTED_INCOMPLETE_LOG_TAIL;
}
