const UNAVAILABLE = "Unavailable";

const SENSITIVE_MARKER = /\b(?:prompt|transcript|credential|credentials|token|authorization|cookie|password|passwd|secret|session|jwt|oauth|api[_ -]?key|(?:access|refresh|id|session|client|private)[_ -]?(?:token|secret|key)|bearer)\b/iu;
const SENSITIVE_QUERY_KEY = /[?&](?:auth|authorization|code|credential|key|password|signature|secret|session|token|api[_-]?key|(?:access|refresh|id|session|client|private)[_-]?(?:token|secret|key))=/iu;
const URL_CREDENTIALS = /\bhttps?:\/\/[^\s/:\x40]+:[^\s/\x40]+\x40/iu;
const FILE_URL = /\bfile:\/{2,3}/iu;
const ABSOLUTE_POSIX_PATH = /(?:^|[\s([{"'=])\/(?!\/)[^\s]/u;
const ABSOLUTE_WINDOWS_PATH = /(?:^|[\s([{"'=])[A-Za-z]:\\/u;
const UNC_PATH = /(?:^|[\s([{"'=])\\\\[^\\\s]+\\[^\\\s]+/u;
const LONG_OPAQUE_VALUE = /\b[A-Za-z0-9_-]{40,}\b/u;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

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

/**
 * Recovery-screen projection only. The native reporter keeps owning its
 * separate diagnostic policy; this function ensures user-visible/copyable
 * details cannot echo common prompt, transcript, credential, or local-path
 * content from an arbitrary thrown message.
 */
export function sanitizeRenderErrorText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(CONTROL_CHARACTERS, "").trim();
  if (
    SENSITIVE_MARKER.test(normalized)
    || SENSITIVE_QUERY_KEY.test(normalized)
    || URL_CREDENTIALS.test(normalized)
    || FILE_URL.test(normalized)
    || ABSOLUTE_POSIX_PATH.test(normalized)
    || ABSOLUTE_WINDOWS_PATH.test(normalized)
    || UNC_PATH.test(normalized)
    || LONG_OPAQUE_VALUE.test(normalized)
  ) {
    return fallback;
  }
  return normalized ? truncate(normalized, maxLength) : fallback;
}

export function parseRenderErrorReleaseIdentity(
  clientReleaseId: string | null | undefined,
): RenderErrorReleaseIdentity {
  const safeRelease = sanitizeRenderErrorText(clientReleaseId, "", 240);
  const match = /^([A-Za-z0-9._-]+)@([^+\s]+)(?:\+([A-Za-z0-9._-]+))?$/u.exec(
    safeRelease,
  );
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
  error: Error;
  componentStack?: string | null;
  clientReleaseId?: string | null;
}): RenderErrorTechnicalDetails {
  return {
    message: sanitizeRenderErrorText(
      input.error.message || input.error.name,
      "Unexpected render error",
      1_000,
    ),
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
