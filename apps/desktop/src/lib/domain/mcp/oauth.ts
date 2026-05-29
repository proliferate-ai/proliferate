import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
} from "@/lib/domain/mcp/types";
import { validateConnectorSettings } from "@/lib/domain/mcp/settings-schema";
import type { TelemetryFailureKind } from "@/lib/domain/telemetry/failures";

export type OAuthCommandErrorKind =
  | "discovery_failed"
  | "registration_failed"
  | "exchange_failed"
  | "refresh_failed"
  | "callback_timeout"
  | "state_mismatch"
  | "unexpected";

export class OAuthConnectorCommandError extends Error {
  readonly kind: OAuthCommandErrorKind;

  readonly retryable: boolean;

  constructor(kind: OAuthCommandErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "OAuthConnectorCommandError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export function validateOAuthConnectorSettings(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "oauth" }>,
  settings?: ConnectorSettings,
): string | null {
  return validateConnectorSettings(catalogEntry, settings);
}

export function classifyOAuthCommandTelemetryFailure(
  kind: OAuthCommandErrorKind,
): TelemetryFailureKind {
  switch (kind) {
    case "discovery_failed":
    case "registration_failed":
    case "exchange_failed":
      return "configuration_error";
    case "refresh_failed":
    case "callback_timeout":
      return "network_error";
    case "state_mismatch":
      return "permission_error";
    case "unexpected":
      return "unknown_error";
  }
}
