export function mcpRootKey() {
  return ["mcp"] as const;
}

export function mcpConnectorsKey() {
  return [...mcpRootKey(), "connectors"] as const;
}
