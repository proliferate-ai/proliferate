export interface ParsedMcpToolName {
  server: string;
  action: string;
}

export function parseMcpToolName(
  value: string | null | undefined,
): ParsedMcpToolName | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("mcp__")) {
    return null;
  }

  const withoutPrefix = trimmed.slice("mcp__".length);
  const separatorIndex = withoutPrefix.indexOf("__");
  if (separatorIndex <= 0 || separatorIndex >= withoutPrefix.length - 2) {
    return null;
  }

  const server = withoutPrefix.slice(0, separatorIndex).trim();
  const action = withoutPrefix.slice(separatorIndex + 2).trim();
  if (!server || !action) {
    return null;
  }

  return { server, action };
}

export function formatMcpActionLabel(action: string): string {
  return toSentenceCase(action);
}

export function formatMcpServerHint(server: string): string {
  return toTitleCase(server);
}

function toSentenceCase(value: string): string {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "Tool call";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
