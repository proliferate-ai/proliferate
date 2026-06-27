import { describe, expect, it } from "vitest";
import { APP_ROUTES, LEGACY_APP_ROUTES } from "@/config/app-routes";

describe("app routes", () => {
  it("registers personal integrations, skills, and workflows as top-level routes", () => {
    expect(APP_ROUTES.integrations).toBe("/integrations");
    expect(APP_ROUTES.skills).toBe("/skills");
    expect(APP_ROUTES.workflows).toBe("/workflows");
  });

  it("does not keep named constants for merged plugin and automation routes", () => {
    expect(APP_ROUTES).not.toHaveProperty("plugins");
    expect(APP_ROUTES).not.toHaveProperty("automations");
    expect(LEGACY_APP_ROUTES.plugins).toBe("/plugins");
    expect(LEGACY_APP_ROUTES.automations).toBe("/automations");
  });

  it("does not keep a named constant for the retired workspace inventory route", () => {
    expect(APP_ROUTES).not.toHaveProperty("workspaces");
  });

  it("does not keep a named constant for the retired powers route", () => {
    expect(APP_ROUTES).not.toHaveProperty("powers");
    expect(LEGACY_APP_ROUTES.powers).toBe("/powers");
  });
});
