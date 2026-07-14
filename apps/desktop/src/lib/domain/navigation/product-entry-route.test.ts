import { describe, expect, it } from "vitest";
import { productEntryRoute } from "./product-entry-route";

describe("productEntryRoute", () => {
  it("maps home, workspace, and workflow destinations with location state", () => {
    expect(productEntryRoute({
      kind: "home",
      query: [["welcome", "yes"]],
      fragment: "top",
    })).toBe("/?welcome=yes#top");
    expect(productEntryRoute({
      kind: "workspace",
      workspaceId: "workspace / ✓",
      query: [["session", "one"]],
    })).toBe("/workspaces/workspace%20%2F%20%E2%9C%93?session=one");
    expect(productEntryRoute({
      kind: "workflow",
      workflowId: "workflow / 1",
    })).toBe("/workflows/workflow%20%2F%201");
  });

  it("routes organization joins to reachable Account settings", () => {
    expect(productEntryRoute({
      kind: "organization-join",
      organizationId: "org / 1",
      serverOrigin: "https://proliferate.example",
      query: [
        ["section", "organization"],
        ["x", "1"],
        ["section", "billing"],
        ["x", "2"],
        ["empty", ""],
      ],
      fragment: "invite",
    })).toBe(
      "/settings?section=account&x=1&x=2&empty=&joinOrganizationId=org+%2F+1&joinServerOrigin=https%3A%2F%2Fproliferate.example#invite",
    );
  });

  it("routes billing and settings callbacks with typed keys exactly once", () => {
    expect(productEntryRoute({
      kind: "billing-return",
      status: "success",
      query: [
        ["checkout", "attacker"],
        ["checkout", "duplicate"],
        ["receipt", "r-1"],
      ],
    })).toBe("/settings?checkout=success&receipt=r-1&section=billing");

    expect(productEntryRoute({
      kind: "settings",
      section: "environments",
      query: [
        ["source", "github_app_installation_callback"],
        ["source", "duplicate"],
        ["repo", "p/r"],
      ],
    })).toBe(
      "/settings?source=github_app_installation_callback&source=duplicate&repo=p%2Fr&section=environments",
    );
  });

  it("routes integration callbacks while preserving residual callback fields", () => {
    expect(productEntryRoute({
      kind: "integration-callback",
      source: "mcp_oauth_callback",
      status: "failed",
      flowId: "flow-1",
      failureCode: "denied",
      query: [["extra", "keep"], ["status", "completed"]],
    })).toBe(
      "/settings?extra=keep&status=failed&section=integrations&source=mcp_oauth_callback&flowId=flow-1&failureCode=denied",
    );

    expect(productEntryRoute({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      query: [["status", "injected"], ["flowId", "injected"], ["extra", "keep"]],
    })).toBe(
      "/settings?status=injected&flowId=injected&extra=keep&section=integrations&source=integration_oauth_callback",
    );
  });

  it("preserves matching typed callback duplicates and invalid residual fields", () => {
    expect(productEntryRoute({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      status: "completed",
      query: [
        ["source", "integration_oauth_callback"],
        ["status", "completed"],
        ["source", "duplicate-source"],
        ["status", "duplicate-status"],
        ["flowId", ""],
      ],
    })).toBe(
      "/settings?source=integration_oauth_callback&status=completed&source=duplicate-source&status=duplicate-status&flowId=&section=integrations",
    );

    expect(productEntryRoute({
      kind: "integration-callback",
      source: "mcp_oauth_callback",
      query: [["status", "unknown"], ["status", "duplicate"]],
    })).toBe(
      "/settings?status=unknown&status=duplicate&section=integrations&source=mcp_oauth_callback",
    );
  });

  it("preserves arbitrary duplicate/empty/Unicode query pairs and a decoded fragment", () => {
    expect(productEntryRoute({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [
        ["x", "1"],
        ["section", "account"],
        ["empty", ""],
        ["status", "first"],
        ["x", "2"],
        ["section", "billing"],
        ["status", "second"],
        ["unicode", "✓"],
      ],
      fragment: "résumé notes",
    })).toBe(
      "/workspaces/ws-1?x=1&section=account&empty=&status=first&x=2&section=billing&status=second&unicode=%E2%9C%93#r%C3%A9sum%C3%A9%20notes",
    );
  });

  it("canonicalizes only the current destination's typed overrides", () => {
    expect(productEntryRoute({
      kind: "billing-return",
      status: "success",
      query: [
        ["source", "first"],
        ["checkout", "injected-first"],
        ["status", "unrelated-first"],
        ["section", "injected-first"],
        ["source", "second"],
        ["checkout", "injected-second"],
        ["status", "unrelated-second"],
        ["section", "injected-second"],
      ],
    })).toBe(
      "/settings?source=first&checkout=success&status=unrelated-first&section=billing&source=second&status=unrelated-second",
    );
  });

  it("leaves the parked invitation destination unsupported", () => {
    expect(productEntryRoute({ kind: "invitation", token: "unused" })).toBeNull();
  });
});
