export type SupportReportUploadFailureKind =
  | "auth_required"
  | "cloud_unconfigured"
  | "dev_auth_bypass"
  | "local_payload_invalid"
  | "storage_unconfigured"
  | "transient";

export interface SupportReportUploadFailure {
  kind: SupportReportUploadFailureKind;
  message: string;
  retryable: boolean;
  retryDelayMs: number | null;
  toastMessage: string;
  toastCooldownMs: number;
}

interface ErrorShape {
  message?: unknown;
  status?: unknown;
  code?: unknown;
}

const SHORT_RETRY_DELAY_MS = 30_000;
const RETRY_AFTER_SIGN_IN_DELAY_MS = 5 * 60_000;
const CONFIG_RETRY_DELAY_MS = 30 * 60_000;
const TRANSIENT_TOAST_COOLDOWN_MS = 5 * 60_000;
const BLOCKED_TOAST_COOLDOWN_MS = 60 * 60_000;

export function describeSupportReportUploadFailure(
  error: unknown,
  attemptCount: number,
): SupportReportUploadFailure {
  const message = supportReportUploadErrorMessage(error);
  const code = supportReportUploadErrorCode(error);
  const status = supportReportUploadErrorStatus(error);

  if (code === "dev_auth_bypass") {
    return {
      kind: "dev_auth_bypass",
      message,
      retryable: true,
      retryDelayMs: CONFIG_RETRY_DELAY_MS,
      toastMessage: "Support reports need real Cloud sign-in. Disable dev auth bypass first.",
      toastCooldownMs: BLOCKED_TOAST_COOLDOWN_MS,
    };
  }

  if (code === "unauthorized" || status === 401) {
    return {
      kind: "auth_required",
      message,
      retryable: true,
      retryDelayMs: RETRY_AFTER_SIGN_IN_DELAY_MS,
      toastMessage: "Sign in to Proliferate Cloud to send support reports. Report is queued.",
      toastCooldownMs: BLOCKED_TOAST_COOLDOWN_MS,
    };
  }

  if (code === "cloud_client_unconfigured") {
    return {
      kind: "cloud_unconfigured",
      message,
      retryable: true,
      retryDelayMs: CONFIG_RETRY_DELAY_MS,
      toastMessage: "Support uploads need Proliferate Cloud configuration. Report is queued.",
      toastCooldownMs: BLOCKED_TOAST_COOLDOWN_MS,
    };
  }

  if (
    code === "support_report_storage_unavailable"
    || message.toLowerCase().includes("support report upload storage is not configured")
  ) {
    return {
      kind: "storage_unconfigured",
      message,
      retryable: true,
      retryDelayMs: CONFIG_RETRY_DELAY_MS,
      toastMessage: "Support uploads are not configured for this server. Report is queued.",
      toastCooldownMs: BLOCKED_TOAST_COOLDOWN_MS,
    };
  }

  if (isLocalPayloadError(message)) {
    return {
      kind: "local_payload_invalid",
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage: "Report is too large or missing attachment data. Try again with fewer files.",
      toastCooldownMs: 0,
    };
  }

  return {
    kind: "transient",
    message,
    retryable: true,
    retryDelayMs: retryDelayMs(attemptCount),
    toastMessage: "Report could not be sent. We'll retry in the background.",
    toastCooldownMs: TRANSIENT_TOAST_COOLDOWN_MS,
  };
}

export function shouldShowSupportReportUploadFailureToast(input: {
  failure: SupportReportUploadFailure;
  lastToastKind?: SupportReportUploadFailureKind | null;
  lastToastAt?: string | null;
  nowMs: number;
}): boolean {
  if (!input.failure.retryable) {
    return true;
  }
  if (input.lastToastKind !== input.failure.kind) {
    return true;
  }
  const lastToastMs = input.lastToastAt ? Date.parse(input.lastToastAt) : Number.NaN;
  if (!Number.isFinite(lastToastMs)) {
    return true;
  }
  return input.nowMs - lastToastMs >= input.failure.toastCooldownMs;
}

function supportReportUploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  const shaped = error as ErrorShape | null;
  if (shaped && typeof shaped.message === "string" && shaped.message.trim()) {
    return shaped.message;
  }
  return "Report upload failed.";
}

function supportReportUploadErrorCode(error: unknown): string | null {
  const shaped = error as ErrorShape | null;
  return shaped && typeof shaped.code === "string" ? shaped.code : null;
}

function supportReportUploadErrorStatus(error: unknown): number | null {
  const shaped = error as ErrorShape | null;
  return shaped && typeof shaped.status === "number" ? shaped.status : null;
}

function isLocalPayloadError(message: string): boolean {
  return message.startsWith("Diagnostics are too large")
    || message.startsWith("Attachments are too large")
    || message.startsWith("Attachment is too large:")
    || message.startsWith("Attachment data is missing:");
}

function retryDelayMs(attemptCount: number): number {
  if (attemptCount <= 1) {
    return SHORT_RETRY_DELAY_MS;
  }
  if (attemptCount === 2) {
    return 5 * 60_000;
  }
  return CONFIG_RETRY_DELAY_MS;
}
