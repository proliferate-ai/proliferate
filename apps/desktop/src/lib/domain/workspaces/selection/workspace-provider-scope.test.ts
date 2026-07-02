import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "@/config/app-routes";
import {
  isWorkspaceProviderRoute,
  resolveRouteScopedWorkspaceProviderId,
} from "./workspace-provider-scope";

describe("workspace provider scope", () => {
  it("keeps the workspace provider active on workspace shell routes", () => {
    expect(isWorkspaceProviderRoute(APP_ROUTES.home)).toBe(true);
    expect(isWorkspaceProviderRoute(APP_ROUTES.settings)).toBe(true);
  });

  it("clears the workspace provider on top-level non-workspace routes", () => {
    expect(resolveRouteScopedWorkspaceProviderId({
      pathname: "/integrations",
      selectedLogicalWorkspaceId: "logical-workspace",
      selectedWorkspaceId: "workspace-1",
    })).toBeNull();

    expect(resolveRouteScopedWorkspaceProviderId({
      pathname: APP_ROUTES.workflows,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: "workspace-1",
    })).toBeNull();
  });

  it("prefers logical identity while a workspace route is active", () => {
    expect(resolveRouteScopedWorkspaceProviderId({
      pathname: APP_ROUTES.home,
      selectedLogicalWorkspaceId: "logical-workspace",
      selectedWorkspaceId: "workspace-1",
    })).toBe("logical-workspace");
  });

  it("falls back to the materialized workspace while a workspace route is active", () => {
    expect(resolveRouteScopedWorkspaceProviderId({
      pathname: APP_ROUTES.home,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: "workspace-1",
    })).toBe("workspace-1");
  });
});
