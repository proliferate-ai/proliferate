const UNAVAILABLE = "Unavailable";

const SENSITIVE_ASSIGNMENT = /\b(prompt|transcript|token|authorization|cookie|password|secret|api[_-]?key)\b\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n]*)/giu;
const BEARER_VALUE = /\bbearer\s+[A-Za-z0-9._~+\-/]+=*/giu;
const SENSITIVE_QUERY_VALUE = /([?&](?:token|key|secret|signature|code)=)[^&#\s]*/giu;
const FILE_URL = /file:\/{2,3}[^\n)]+/giu;
const POSIX_PRIVATE_PATH = /\/(?:Users|home|private|Volumes|tmp|var\/folders)\/[^\n)]+/gu;
const WINDOWS_PRIVATE_PATH = /\b[A-Za-z]:\\[^\n)]+/gu;
const LONG_OPAQUE_VALUE = /\b[A-Za-z0-9_-]{40,}\b/gu;
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
  const normalized = value
    .replace(CONTROL_CHARACTERS, "")
    .replace(SENSITIVE_ASSIGNMENT, (_match, label: string) => `${label}=[redacted]`)
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(SENSITIVE_QUERY_VALUE, "$1[redacted]")
    .replace(FILE_URL, "[private path]")
    .replace(POSIX_PRIVATE_PATH, "[private path]")
    .replace(WINDOWS_PRIVATE_PATH, "[private path]")
    .replace(LONG_OPAQUE_VALUE, "[redacted]")
    .trim();
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
