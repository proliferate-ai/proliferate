import type { SavedConnectorMetadata } from "@/lib/domain/mcp/types";

const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/g;
const EDGE_UNDERSCORES = /^_+|_+$/g;
const MAX_SERVER_NAME_BASE = 40;

function normalizeServerNameBase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RUN, "_")
    .replace(EDGE_UNDERSCORES, "");
  if (!normalized) {
    return "mcp";
  }
  return normalized.slice(0, MAX_SERVER_NAME_BASE) || "mcp";
}

export function generateConnectorServerName(
  base: string,
  connectionId: string,
  existing: SavedConnectorMetadata[],
): string {
  const normalizedBase = normalizeServerNameBase(base);
  const existingNames = new Set(existing.map((item) => item.serverName));
  if (!existingNames.has(normalizedBase)) {
    return normalizedBase;
  }
  return `${normalizedBase}_${connectionId.replace(/-/g, "").slice(0, 6)}`;
}
