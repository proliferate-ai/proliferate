import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: vi.fn(),
}));

import {
  handleDesktopNavigationUrl,
  type AuthOrchestrationDeps,
} from "@/lib/integrations/auth/orchestration-effects";

function createDeps(): AuthOrchestrationDeps {
  return {
    getAuthState: vi.fn(),
    setAuthState: vi.fn(),
    clearSessionRuntimeState: vi.fn(),
    closeRepoSetupModal: vi.fn(),
    showToast: vi.fn(),
    navigateDesktopRoute: vi.fn(),
  };
}

describe("handleDesktopNavigationUrl", () => {
  it("routes desktop navigation deep links through app navigation", () => {
    const deps = createDeps();

    const handled = handleDesktopNavigationUrl(
      "proliferate://plugins?source=mcp_oauth_callback&status=completed",
      deps,
    );

    expect(handled).toBe(true);
    expect(deps.navigateDesktopRoute).toHaveBeenCalledWith(
      "/integrations?source=mcp_oauth_callback&status=completed",
    );
  });

  it("ignores unsupported deep links", () => {
    const deps = createDeps();

    const handled = handleDesktopNavigationUrl("proliferate://plugins/extra", deps);

    expect(handled).toBe(false);
    expect(deps.navigateDesktopRoute).not.toHaveBeenCalled();
  });
});
