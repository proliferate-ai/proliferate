import { describe, expect, it } from "vitest";
import { APP_ROUTES, LEGACY_APP_ROUTES } from "@/config/app-routes";

describe("app routes", () => {
  it("registers plugins as the canonical integrations route", () => {
    expect(APP_ROUTES.plugins).toBe("/plugins");
  });

  it("registers the cloud-visible workspace inventory route", () => {
    expect(APP_ROUTES.workspaces).toBe("/workspaces");
  });

  it("registers the archived workspace inventory route", () => {
    expect(APP_ROUTES.archivedWorkspaces).toBe("/workspaces/archived");
  });

  it("does not keep a named constant for the retired powers route", () => {
    expect(APP_ROUTES).not.toHaveProperty("powers");
    expect(LEGACY_APP_ROUTES.powers).toBe("/powers");
  });
});
