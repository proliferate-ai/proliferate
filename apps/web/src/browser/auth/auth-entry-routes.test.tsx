// @vitest-environment jsdom
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const publishIssue = vi.fn<(issue: ProductAuthIssue) => void>();

vi.mock("../cloud/WebCloudRoot", () => ({
  useWebSession: () => ({ publishIssue }),
}));

import { AuthErrorRoute } from "./AuthErrorRoute";
import { SsoLoginEntryRoute, SSO_LOGIN_SLUG_STATE_KEY } from "./SsoLoginEntryRoute";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function LoginProbe() {
  const location = useLocation();
  const state = location.state as Record<string, unknown> | null;
  return (
    <div data-testid="login" data-slug={String(state?.[SSO_LOGIN_SLUG_STATE_KEY] ?? "")} />
  );
}

describe("SsoLoginEntryRoute", () => {
  it("seeds the shared login screen with the decoded org slug", async () => {
    const { findByTestId } = render(
      <MemoryRouter initialEntries={["/login/acme"]}>
        <Routes>
          <Route path="/login/:slug" element={<SsoLoginEntryRoute />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    const probe = await findByTestId("login");
    expect(probe.getAttribute("data-slug")).toBe("acme");
  });
});

describe("AuthErrorRoute", () => {
  function renderError(code: string) {
    return render(
      <MemoryRouter initialEntries={[`/auth/error?code=${code}`]}>
        <Routes>
          <Route path="/auth/error" element={<AuthErrorRoute />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("publishes an access_denied issue for a denial code and enters the product", async () => {
    const { findByTestId } = renderError("sso_email_domain_not_allowed");
    await findByTestId("home");
    expect(publishIssue).toHaveBeenCalledTimes(1);
    expect(publishIssue).toHaveBeenCalledWith({
      kind: "access_denied",
      code: "sso_email_domain_not_allowed",
    });
  });

  it("publishes a callback_failed issue for a non-denial server error code", async () => {
    const { findByTestId } = renderError("sso_state_invalid");
    await findByTestId("home");
    expect(publishIssue).toHaveBeenCalledWith({
      kind: "callback_failed",
      reason: "provider_error",
      providerCode: "sso_state_invalid",
    });
  });
});
