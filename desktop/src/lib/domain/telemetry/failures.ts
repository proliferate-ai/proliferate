import { AuthRequestError } from "@/lib/integrations/auth/proliferate-auth";

export type TelemetryFailureKind =
  | "aborted"
  | "configuration_error"
  | "network_error"
  | "permission_error"
  | "request_error"
  | "unknown_error";

export function classifyTelemetryFailure(error: unknown): TelemetryFailureKind {
  if (error instanceof Error && error.name === "AbortError") {
    return "aborted";
  }

  if (error instanceof AuthRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "permission_error";
    }
    if (error.status >= 400 && error.status < 500) {
      return "configuration_error";
    }
    if (error.status >= 500) {
      return "request_error";
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("network")
    || normalized.includes("fetch")
    || normalized.includes("timeout")
    || normalized.includes("timed out")
    || normalized.includes("socket")
    || normalized.includes("connection")
  ) {
    return "network_error";
  }

  if (
    normalized.includes("not configured")
    || normalized.includes("configuration")
    || normalized.includes("missing")
    || normalized.includes("invalid")
    || normalized.includes("unsupported")
  ) {
    return "configuration_error";
  }

  if (
    normalized.includes("permission")
    || normalized.includes("forbidden")
    || normalized.includes("unauthorized")
  ) {
    return "permission_error";
  }

  return "unknown_error";
}
