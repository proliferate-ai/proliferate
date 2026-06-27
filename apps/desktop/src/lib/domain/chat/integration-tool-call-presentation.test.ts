import { describe, expect, it } from "vitest";
import { integrationGatewayToolNameFromMcpName } from "./integration-tool-call-presentation";

describe("integrationGatewayToolNameFromMcpName", () => {
  it("extracts the namespaced gateway tool name from the integrations MCP server", () => {
    expect(
      integrationGatewayToolNameFromMcpName(
        "mcp__proliferate_integrations__sentry__find_projects",
      ),
    ).toBe("sentry__find_projects");
  });

  it("ignores non-integration MCP tool names", () => {
    expect(integrationGatewayToolNameFromMcpName("mcp__subagents__create_subagent")).toBeNull();
  });
});
