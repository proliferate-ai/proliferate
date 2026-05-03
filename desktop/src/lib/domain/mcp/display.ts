import type { ConnectorCatalogEntry } from "./types";

export type ConnectorAuthLabel = "OAuth" | "API key" | "No credentials";
export type ConnectorAvailabilityLabel = "Local + Cloud" | "Local only" | "Cloud only";

export function getConnectorAuthLabel(entry: ConnectorCatalogEntry): ConnectorAuthLabel {
  if (entry.authKind === "oauth") {
    return "OAuth";
  }
  if (entry.authKind === "secret") {
    return "API key";
  }
  return "No credentials";
}

export function getConnectorAvailabilityLabel(entry: ConnectorCatalogEntry): ConnectorAvailabilityLabel {
  switch (entry.availability) {
    case "universal":
      return "Local + Cloud";
    case "local_only":
      return "Local only";
    case "cloud_only":
      return "Cloud only";
  }
}
