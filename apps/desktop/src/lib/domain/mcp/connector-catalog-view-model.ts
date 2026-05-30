import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";

export type ConnectorCardStatusIntent =
  | "connected"
  | "needs_token"
  | "needs_reconnect"
  | "off";

export interface ConnectorCardStatus {
  intent: ConnectorCardStatusIntent;
  label: string;
  actionable: boolean;
  tone: "neutral" | "muted" | "warning" | "error";
}

export function resolveConnectorStatus(record: InstalledConnectorRecord): ConnectorCardStatus {
  const isOAuth =
    record.catalogEntry.transport === "http" && record.catalogEntry.authKind === "oauth";
  const isLocalOAuth = record.catalogEntry.setupKind === "local_oauth";

  if (record.broken && (isOAuth || isLocalOAuth)) {
    return {
      intent: "needs_reconnect",
      label: "Needs reconnect",
      actionable: true,
      tone: "error",
    };
  }
  if (record.broken) {
    return {
      intent: "needs_token",
      label: "Needs token",
      actionable: true,
      tone: "error",
    };
  }
  if (!record.metadata.enabled) {
    return {
      intent: "off",
      label: "Off",
      actionable: false,
      tone: "muted",
    };
  }
  return {
    intent: "connected",
    label: "Connected",
    actionable: false,
    tone: "neutral",
  };
}
