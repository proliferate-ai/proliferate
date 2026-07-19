const UNAVAILABLE = "Unavailable";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const SAFE_ERROR_MESSAGES = new Set([
  "Failed to fetch",
  "Load failed",
  "Maximum call stack size exceeded",
  "NetworkError when attempting to fetch resource.",
  "Too much recursion",
  "Unexpected end of JSON input",
  "Unexpected end of JSON input.",
  "Workspace panel failed to render",
]);
const SAFE_PROPERTY_ERROR = /^Cannot (?:read|set) properties of (?:undefined|null) \((?:reading|setting) '([A-Za-z_$][A-Za-z0-9_$]*)'\)$/u;
const SAFE_LEGACY_PROPERTY_ERROR = /^Cannot read property '([A-Za-z_$][A-Za-z0-9_$]*)' of (?:undefined|null)$/u;
const SENSITIVE_IDENTIFIER = /prompt|transcript|credential|token|authorization|cookie|password|passwd|secret|session|jwt|oauth|apikey/iu;
const SAFE_ERROR_MESSAGE_PATTERNS = [
  /^Unexpected token '[<>{}\[\],:]' in JSON(?: at position \d+)?\.?$/u,
  /^Loading chunk \d+ failed\.?$/u,
  /^Minified React error #\d+\.?$/u,
  /^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)\.?$/u,
];
const SAFE_COMPONENT_STACK_LINE = /^\s*at [A-Za-z_$][A-Za-z0-9_$.]*(?: \((?:(?:[A-Za-z0-9_$@.-]+\/)*[A-Za-z0-9_$@.-]+(?::\d+){0,2}|<anonymous>)\))?\s*$/u;
const SAFE_RELEASE_ID = /^([A-Za-z0-9][A-Za-z0-9._-]{0,79})@([A-Za-z0-9][A-Za-z0-9._-]{0,79})(?:\+([A-Za-z0-9][A-Za-z0-9._-]{0,79}))?$/u;

export type RenderErrorReportStatus =
  | "reporting"
  | "reported"
  | "failed"
  | "unavailable";

export interface RenderErrorReleaseIdentity {
  app: string;
  version: string;
  release: string;
  build: string;
}

export interface RenderErrorTechnicalDetails {
  message: string;
  componentStack: string;
  identity: RenderErrorReleaseIdentity;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isSafeErrorMessage(value: string): boolean {
  if (
    SAFE_ERROR_MESSAGES.has(value)
    || SAFE_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    return true;
  }
  const property = SAFE_PROPERTY_ERROR.exec(value)
    ?? SAFE_LEGACY_PROPERTY_ERROR.exec(value);
  return Boolean(property && !SENSITIVE_IDENTIFIER.test(property[1]));
}

/**
 * Recovery-screen projection only. The native reporter keeps owning its
 * separate diagnostic policy; this function ensures user-visible/copyable
 * details cannot echo prompt, transcript, credential, path, or other arbitrary
 * content from a thrown value. Only known runtime templates and relative React
 * component-stack frames are preserved; everything else fails closed.
 */
export function sanitizeRenderErrorText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(CONTROL_CHARACTERS, "");
  if (cleaned !== value) return fallback;
  const normalized = cleaned.trim();
  if (!normalized || normalized.length > maxLength) return fallback;

  if (isSafeErrorMessage(normalized)) {
    return truncate(normalized, maxLength);
  }

  const lines = normalized.split("\n");
  if (
    lines.length > 0
    && lines.every(
      (line) =>
        line.length <= 400
        && !line.includes("../")
        && SAFE_COMPONENT_STACK_LINE.test(line),
    )
  ) {
    return truncate(normalized, maxLength);
  }

  return fallback;
}

function ownStringDataProperty(value: unknown, key: string): string | null {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function normalizeRenderError(error: unknown): Error {
  const candidate = typeof error === "string"
    ? error
    : ownStringDataProperty(error, "message");
  return new Error(
    sanitizeRenderErrorText(candidate, "Unexpected render error", 1_000),
  );
}

export function parseRenderErrorReleaseIdentity(
  clientReleaseId: string | null | undefined,
): RenderErrorReleaseIdentity {
  const safeRelease = typeof clientReleaseId === "string"
    && clientReleaseId.length <= 240
    ? clientReleaseId.trim()
    : "";
  const match = SAFE_RELEASE_ID.exec(safeRelease);
  if (!match) {
    return {
      app: UNAVAILABLE,
      version: UNAVAILABLE,
      release: UNAVAILABLE,
      build: UNAVAILABLE,
    };
  }
  return {
    app: match[1],
    version: match[2],
    release: safeRelease,
    build: match[3] ?? UNAVAILABLE,
  };
}

export function buildRenderErrorTechnicalDetails(input: {
  error: unknown;
  componentStack?: string | null;
  clientReleaseId?: string | null;
}): RenderErrorTechnicalDetails {
  const normalizedError = normalizeRenderError(input.error);
  return {
    message: normalizedError.message,
    componentStack: sanitizeRenderErrorText(
      input.componentStack,
      UNAVAILABLE,
      8_000,
    ),
    identity: parseRenderErrorReleaseIdentity(input.clientReleaseId),
  };
}

export function reportStatusLabel(status: RenderErrorReportStatus): string {
  switch (status) {
    case "reporting":
      return "Sending";
    case "reported":
      return "Reported";
    case "failed":
      return "Failed";
    case "unavailable":
      return UNAVAILABLE;
  }
}

export function formatRenderErrorDetails(
  details: RenderErrorTechnicalDetails,
  reportStatus: RenderErrorReportStatus,
): string {
  return [
    "Proliferate crash recovery details",
    `Error message: ${details.message}`,
    "Component stack:",
    details.componentStack,
    `App: ${details.identity.app}`,
    `Version: ${details.identity.version}`,
    `Release: ${details.identity.release}`,
    `Build: ${details.identity.build}`,
    `Report status: ${reportStatusLabel(reportStatus)}`,
  ].join("\n");
}
