import { describe, expect, it } from "vitest";
import { legacyWorkflowRedirectHref, routes } from "./routes";

describe("legacyWorkflowRedirectHref", () => {
  it("preserves a workflow ID, query, and hash", () => {
    expect(legacyWorkflowRedirectHref(
      routes.workflows,
      "workflow-1",
      "?source=legacy",
      "#details",
    )).toBe("/workflows/workflow-1?source=legacy#details");
  });

  it("keeps the legacy list route on the workflow list", () => {
    expect(legacyWorkflowRedirectHref(
      routes.workflows,
      undefined,
      "?source=legacy",
      "#list",
    )).toBe("/workflows?source=legacy#list");
  });
});
