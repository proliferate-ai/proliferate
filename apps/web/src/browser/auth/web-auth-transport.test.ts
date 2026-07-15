import type { AuthSessionResponse } from "@proliferate/cloud-sdk";
import { isLoginNotAttempted } from "@proliferate/product-client/internal/lib/domain/telemetry/errors";
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWebAuthOperations,
  decodeWebAuthCallback,
  mapFailureCallbackIssue,
} from "./web-auth-transport";

vi.mock("../../lib/access/cloud/auth/web-auth-flow", () => ({
  startWebAuthFlow: vi.fn(async () => {}),
  startWebSsoFlow: vi.fn(async () => {}),
  startWebSsoFlowForSlug: vi.fn(async () => {}),
  completeWebAuthFlow: vi.fn(),
  webAuthFlowErrorCode: (error: unknown) =>
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null,
}));

import * as flow from "../../lib/access/cloud/auth/web-auth-flow";

const flowMock = vi.mocked(flow);

afterEach(() => {
  vi.clearAllMocks();
});

describe("decodeWebAuthCallback", () => {
  it("decodes a success (code+state)", () => {
    expect(
      decodeWebAuthCallback(new URLSearchParams("code=abc&state=xyz")),
    ).toEqual({ status: "success", code: "abc", state: "xyz" });
  });

  it("decodes a provider error as a failure", () => {
    expect(
      decodeWebAuthCallback(new URLSearchParams("error=access_denied&state=xyz")),
    ).toEqual({ status: "failure", code: "access_denied", state: "xyz" });
  });

  it("decodes a missing code/state as a malformed-callback failure", () => {
    expect(decodeWebAuthCallback(new URLSearchParams("state=xyz"))).toEqual({
      status: "failure",
      code: "missing_callback_params",
      state: "xyz",
    });
  });
});

describe("mapFailureCallbackIssue", () => {
  it("maps beta denials to access_denied", () => {
    expect(mapFailureCallbackIssue("web_beta_email_not_allowed")).toEqual({
      kind: "access_denied",
      code: "web_beta_email_not_allowed",
    });
  });

  it("maps SSO denial codes to access_denied", () => {
    expect(mapFailureCallbackIssue("sso_email_domain_not_allowed")).toEqual({
      kind: "access_denied",
      code: "sso_email_domain_not_allowed",
    });
  });

  it("maps a missing-params code to a malformed callback failure", () => {
    expect(mapFailureCallbackIssue("missing_callback_params")).toEqual({
      kind: "callback_failed",
      reason: "malformed_callback",
    });
  });

  it("maps an unknown provider code to a provider_error callback failure", () => {
    expect(mapFailureCallbackIssue("provider_boom")).toEqual({
      kind: "callback_failed",
      reason: "provider_error",
      providerCode: "provider_boom",
    });
  });
});

describe("createWebAuthOperations", () => {
  function makeOps() {
    const issues: ProductAuthIssue[] = [];
    const sessions: AuthSessionResponse[] = [];
    const ops = createWebAuthOperations({
      setSession: (s) => sessions.push(s),
      publishIssue: (i) => issues.push(i),
      logout: vi.fn(async () => {}),
    });
    return { ops, issues, sessions };
  }

  it("starts github OAuth through the browser flow", async () => {
    const { ops } = makeOps();
    void ops.startLogin({ kind: "github" });
    await Promise.resolve();
    expect(flowMock.startWebAuthFlow).toHaveBeenCalledWith({
      provider: "github",
      purpose: undefined,
    });
  });

  it("starts slug SSO through the browser flow", async () => {
    const { ops } = makeOps();
    void ops.startLogin({ kind: "sso", slug: "acme" });
    await Promise.resolve();
    expect(flowMock.startWebSsoFlowForSlug).toHaveBeenCalledWith("acme");
  });

  it("rejects password/apple as not-attempted so no failure event is emitted", async () => {
    const { ops } = makeOps();
    await expect(ops.startLogin({ kind: "password", email: "a", password: "b" }))
      .rejects.toSatisfy(isLoginNotAttempted);
    await expect(ops.startLogin({ kind: "apple" })).rejects.toSatisfy(
      isLoginNotAttempted,
    );
  });

  it("finishLogin commits the exchanged session on success", async () => {
    const session = { accessToken: "tok", user: { id: "u1" } } as AuthSessionResponse;
    flowMock.completeWebAuthFlow.mockResolvedValueOnce(session);
    const { ops, sessions } = makeOps();
    await ops.finishLogin({ status: "success", code: "c", state: "s" });
    expect(sessions).toEqual([session]);
  });

  it("finishLogin publishes the mapped issue and rethrows on a failure callback", async () => {
    const { ops, issues } = makeOps();
    await expect(
      ops.finishLogin({ status: "failure", code: "web_beta_email_not_allowed" }),
    ).rejects.toThrow();
    expect(issues).toEqual([
      { kind: "access_denied", code: "web_beta_email_not_allowed" },
    ]);
    expect(flowMock.completeWebAuthFlow).not.toHaveBeenCalled();
  });

  it("finishLogin publishes a callback_failed issue when the exchange throws", async () => {
    flowMock.completeWebAuthFlow.mockRejectedValueOnce(
      new Error("The stored PKCE record did not match."),
    );
    const { ops, issues } = makeOps();
    await expect(
      ops.finishLogin({ status: "success", code: "c", state: "s" }),
    ).rejects.toThrow();
    expect(issues).toEqual([{ kind: "callback_failed", reason: "state_mismatch" }]);
  });
});

describe("production bootstrap never touches a bearer token in localStorage", () => {
  const files = [
    "./web-auth-transport.ts",
    "../cloud/create-web-cloud-client.ts",
    "../cloud/WebCloudRoot.tsx",
  ];

  // A real ES import of the deleted store — not an incidental mention in a doc
  // comment explaining why the store must not be imported.
  const authTokenStoreImport = /import[^\n]*from\s+["'][^"']*auth-token-store/;

  it("no bootstrap-path browser adapter imports the deleted auth-token-store or its key", () => {
    for (const rel of files) {
      const source = readFileSync(
        fileURLToPath(new URL(rel, import.meta.url)),
        "utf-8",
      );
      expect(authTokenStoreImport.test(source), `${rel} imports auth-token-store`).toBe(
        false,
      );
      expect(source, rel).not.toContain("proliferate.web.authToken");
    }
  });
});
