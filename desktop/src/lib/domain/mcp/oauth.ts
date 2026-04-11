import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";
import type { TelemetryFailureKind } from "@/lib/domain/telemetry/failures";
import type { OAuthCommandErrorKind } from "@/platform/tauri/mcp-oauth";

export function buildSupabaseConnectorUrl(settings: SupabaseConnectorSettings): string {
  const url = new URL("https://mcp.supabase.com/mcp");
  url.searchParams.set("project_ref", settings.projectRef);
  url.searchParams.set("read_only", settings.readOnly ? "true" : "false");
  return url.toString();
}

export function buildOAuthConnectorServerUrl(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "oauth" }>,
  settings?: ConnectorSettings,
): string {
  if (catalogEntry.id === "supabase") {
    if (settings?.kind !== "supabase") {
      return catalogEntry.url;
    }
    return buildSupabaseConnectorUrl(settings);
  }
  return catalogEntry.url;
}

export function validateOAuthConnectorSettings(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "oauth" }>,
  settings?: ConnectorSettings,
): string | null {
  if (catalogEntry.id !== "supabase") {
    return null;
  }
  if (settings?.kind !== "supabase") {
    return "Choose a Supabase project before connecting.";
  }
  if (settings.projectRef.trim().length === 0) {
    return "Choose a Supabase project before connecting.";
  }
  return null;
}

export function connectorSettingsEqual(
  left: ConnectorSettings | undefined,
  right: ConnectorSettings | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "supabase" && right.kind === "supabase") {
    return left.projectRef === right.projectRef && left.readOnly === right.readOnly;
  }
  return false;
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
