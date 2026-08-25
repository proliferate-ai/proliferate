// @vitest-environment jsdom
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const publishIssue = vi.fn<(issue: ProductAuthIssue) => void>();

vi.mock("../cloud/WebCloudRoot", () => ({
  useWebSession: () => ({ publishIssue }),
}));

import { AuthErrorRoute } from "./AuthErrorRoute";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    const { findByTestId } = renderError("web_beta_email_not_allowed");
    await findByTestId("home");
    expect(publishIssue).toHaveBeenCalledTimes(1);
    expect(publishIssue).toHaveBeenCalledWith({
      kind: "access_denied",
      code: "web_beta_email_not_allowed",
    });
  });

  it("publishes a callback_failed issue for a non-denial server error code", async () => {
    const { findByTestId } = renderError("identity_state_invalid");
    await findByTestId("home");
    expect(publishIssue).toHaveBeenCalledWith({
      kind: "callback_failed",
      reason: "provider_error",
      providerCode: "identity_state_invalid",
    });
  });
});
