import { describe, expect, it } from "vitest";
import {
  integrationGatewayToolNameFromMcpName,
  integrationToolDisplayNameFromMetadata,
} from "./integration-tool-call-presentation";

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

describe("integrationToolDisplayNameFromMetadata", () => {
  it("keeps concise display names from metadata", () => {
    expect(
      integrationToolDisplayNameFromMetadata({
        displayName: "Find projects",
        gatewayToolName: "sentry__find_projects",
        upstreamToolName: "find_projects",
      }),
    ).toBe("Find projects");
  });

  it("falls back to the upstream tool name when metadata contains a tool description", () => {
    expect(
      integrationToolDisplayNameFromMetadata({
        displayName:
          "Find projects in Sentry. Use this tool when you need to view projects in a Sentry organization.",
        gatewayToolName: "sentry__find_projects",
        upstreamToolName: "find_projects",
      }),
    ).toBe("Find projects");
  });
});
