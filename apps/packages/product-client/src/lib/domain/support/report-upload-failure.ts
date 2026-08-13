export type SupportReportUploadFailureKind =
  | "already_completed"
  | "auth_required"
  | "cloud_unconfigured"
  | "dev_auth_bypass"
  | "local_payload_invalid"
  | "snapshot_mismatch"
  | "snapshot_missing"
  | "storage_unconfigured"
  | "upload_conflict"
  | "upload_rejected"
  | "transient";

export interface SupportReportUploadFailure {
  kind: SupportReportUploadFailureKind;
  message: string;
  retryable: boolean;
  retryDelayMs: number | null;
  toastMessage: string;
  toastCooldownMs: number;
}

export interface SupportReportUploadErrorSnapshot {
  message: string;
  status: number | null;
  code: string | null;
}

const snapshotArtifactFailures = new WeakMap<object, "snapshot_mismatch" | "snapshot_missing">();
const localPayloadFailures = new WeakSet<object>();

export class SupportSnapshotArtifactError extends Error {
  readonly code: "snapshot_mismatch" | "snapshot_missing";

  constructor(code: "snapshot_mismatch" | "snapshot_missing") {
    super(code === "snapshot_missing"
      ? "The prepared diagnostic snapshot is missing."
      : "The prepared diagnostic snapshot no longer matches its receipt.");
    this.name = "SupportSnapshotArtifactError";
    this.code = code;
    snapshotArtifactFailures.set(this, code);
  }
}

/** An owned local discriminant; arbitrary thrown prose cannot impersonate it. */
export class SupportReportLocalPayloadError extends Error {
  readonly code = "local_payload_invalid";

  constructor(message: string) {
    super(message);
    this.name = "SupportReportLocalPayloadError";
    localPayloadFailures.add(this);
  }
}

const SHORT_RETRY_DELAY_MS = 30_000;
const RETRY_AFTER_SIGN_IN_DELAY_MS = 5 * 60_000;
const CONFIG_RETRY_DELAY_MS = 30 * 60_000;
const TRANSIENT_TOAST_COOLDOWN_MS = 5 * 60_000;
const BLOCKED_TOAST_COOLDOWN_MS = 60 * 60_000;

// A queued report that never succeeds must eventually be dropped — otherwise a
// single un-completable report retries (and re-toasts) forever across restarts.
const MAX_SUPPORT_REPORT_ATTEMPTS = 8;
const MAX_SUPPORT_REPORT_AGE_MS = 48 * 60 * 60_000;

export function describeSupportReportUploadFailure(
  error: unknown,
  attemptCount: number,
): SupportReportUploadFailure {
  const snapshot = snapshotSupportReportUploadError(error);
  const { message, code, status } = snapshot;

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

  const snapshotFailure = ownedSnapshotArtifactFailure(error);
  if (snapshotFailure) {
    return {
      kind: snapshotFailure,
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage:
        "The diagnostic snapshot is no longer available. Start a new report from Help.",
      toastCooldownMs: 0,
    };
  }

  if (code === "support_report_storage_unavailable") {
    return {
      kind: "storage_unconfigured",
      message,
      retryable: true,
      retryDelayMs: CONFIG_RETRY_DELAY_MS,
      toastMessage: "Support uploads are not configured for this server. Report is queued.",
      toastCooldownMs: BLOCKED_TOAST_COOLDOWN_MS,
    };
  }

  if (isLocalPayloadFailure(error)) {
    return {
      kind: "local_payload_invalid",
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage: "Report is too large or missing attachment data. Try again with fewer files.",
      toastCooldownMs: 0,
    };
  }

  // The report already completed on a prior attempt (e.g. the complete call
  // landed but the client lost the response before clearing the job). This is
  // success, not failure — the queue treats `already_completed` as idempotent
  // cleanup rather than showing an error.
  if (code === "support_report_already_completed") {
    return {
      kind: "already_completed",
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage: "Report already sent. Support has the details.",
      toastCooldownMs: 0,
    };
  }

  // Terminal upload-target conflict: the report's locked object set / intent can
  // never reconcile with this request, so retrying the same job is hopeless.
  if (code === "support_report_upload_conflict") {
    return {
      kind: "upload_conflict",
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage:
        "This report can no longer be sent. Start a new report from Help if you still need support.",
      toastCooldownMs: 0,
    };
  }

  // Any other upload-invalid (HTTP 400) is a permanent server-side rejection of
  // the request payload (diagnostics too large, object size mismatch, workspace
  // selection, etc.). Retrying the same request can't fix it, so it is terminal
  // rather than transient — otherwise it would retry until the age backstop.
  if (code === "support_report_upload_invalid" || status === 400) {
    return {
      kind: "upload_rejected",
      message,
      retryable: false,
      retryDelayMs: null,
      toastMessage:
        "This report was rejected and can't be sent as-is. Start a new report from Help.",
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
  lastToastKind?: string | null;
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

/**
 * Takes one no-throw snapshot of stable own data fields. Accessors, prototype
 * values, hostile proxies, and revoked proxies are deliberately ignored.
 */
export function snapshotSupportReportUploadError(
  error: unknown,
): SupportReportUploadErrorSnapshot {
  const ownMessage = ownDataValue(error, "message");
  const ownCode = ownDataValue(error, "code");
  const ownStatus = ownDataValue(error, "status");
  const message = typeof error === "string" && error.trim()
    ? error
    : typeof ownMessage === "string" && ownMessage.trim()
      ? ownMessage
      : "Report upload failed.";
  return {
    message,
    code: typeof ownCode === "string" ? ownCode : null,
    status: typeof ownStatus === "number" && Number.isSafeInteger(ownStatus)
      ? ownStatus
      : null,
  };
}

function ownDataValue(value: unknown, key: "code" | "message" | "status"): unknown {
  if (!isObject(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function ownedSnapshotArtifactFailure(
  error: unknown,
): "snapshot_mismatch" | "snapshot_missing" | null {
  return isObject(error) ? snapshotArtifactFailures.get(error) ?? null : null;
}

function isLocalPayloadFailure(error: unknown): boolean {
  return isObject(error) && localPayloadFailures.has(error);
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

// Terminal-retry guard: a retryable failure that has exhausted its attempt
// budget or aged out should be dropped rather than retried forever. This is the
// systemic safety net for any failure that is misclassified as transient.
export function supportReportRetriesExhausted(input: {
  kind: SupportReportUploadFailureKind;
  attemptCount: number;
  createdAt?: string | null;
  nowMs: number;
}): boolean {
  // The attempt budget bounds only genuinely-transient failures. Blocked-on-user
  // / config states (auth_required, cloud/storage unconfigured, dev_auth_bypass)
  // burn attempts in minutes but resolve when the user signs in or the server is
  // configured, so they are NOT attempt-capped — only the age backstop applies.
  if (input.kind === "transient" && input.attemptCount >= MAX_SUPPORT_REPORT_ATTEMPTS) {
    return true;
  }
  // Age backstop bounds every retryable failure so nothing retries forever — a
  // report stuck for 48h is stale regardless of why (e.g. a server that will
  // never be configured).
  const createdMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
  return Number.isFinite(createdMs)
    && input.nowMs - createdMs >= MAX_SUPPORT_REPORT_AGE_MS;
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
