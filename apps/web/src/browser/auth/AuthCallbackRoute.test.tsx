// @vitest-environment jsdom
import type { AuthCallback } from "@proliferate/product-client/host/product-host";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const finishLogin = vi.fn<(callback: AuthCallback) => Promise<void>>();

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ auth: { finishLogin } }),
}));

import { AuthCallbackRoute } from "./AuthCallbackRoute";

function renderCallback(search: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackRoute />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthCallbackRoute", () => {
  it("exchanges and commits exactly once under Strict Mode", async () => {
    finishLogin.mockResolvedValue();
    const { findByTestId } = renderCallback("?code=abc&state=xyz");

    // Strict Mode mounts/unmounts/mounts; the single-flight ref must keep the
    // exchange to exactly one call, and the route then enters the product.
    await findByTestId("home");
    expect(finishLogin).toHaveBeenCalledTimes(1);
    expect(finishLogin).toHaveBeenCalledWith({
      status: "success",
      code: "abc",
      state: "xyz",
    });
  });

  it("hands a malformed callback to finishLogin as a visible failure", async () => {
    finishLogin.mockRejectedValue(new Error("callback failed"));
    const { findByTestId } = renderCallback("?state=xyz");

    // A failure still resolves the route (into the shared anonymous auth-error
    // state) rather than falling through into an authenticated product route.
    await findByTestId("home");
    expect(finishLogin).toHaveBeenCalledTimes(1);
    expect(finishLogin).toHaveBeenCalledWith({
      status: "failure",
      code: "missing_callback_params",
      state: "xyz",
    });
  });

});
