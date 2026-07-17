// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthRequestError,
  InteractiveAuthTimeoutError,
} from "#product/lib/access/cloud/auth-transport";
import {
  makeTestProductHost,
  productHostWrapper,
} from "#product/test/product-host-test-utils";
import { useAuditedAuth } from "./use-audited-auth";

afterEach(cleanup);

function harness(error: Error) {
  const captureException = vi.fn();
  const track = vi.fn();
  const host = makeTestProductHost({
    auth: {
      startLogin: vi.fn(async () => {
        throw error;
      }),
    },
    overrides: {
      telemetry: {
        track,
        captureException,
        setUser: vi.fn(),
        setTag: vi.fn(),
        routeChanged: vi.fn(),
        getSupportContext: () => ({ clientReleaseId: "desktop@test" }),
        getAnonymousInstallId: async () => null,
      },
    },
  });
  return {
    captureException,
    track,
    ...renderHook(() => useAuditedAuth(), {
      wrapper: productHostWrapper(host),
    }),
  };
}

describe("useAuditedAuth", () => {
  it("tracks an interactive timeout without capturing it as an exception", async () => {
    const error = new InteractiveAuthTimeoutError("Sign-in timed out.");
    const { result, captureException, track } = harness(error);

    await act(async () => {
      await expect(
        result.current.startLogin({ kind: "github" }),
      ).rejects.toBe(error);
    });

    expect(captureException).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith({
      name: "auth_sign_in_failed",
      properties: {
        failure_kind: "configuration_error",
        provider: "github",
      },
    });
  });

  it("captures an unbranded HTTP 408 response", async () => {
    const error = new AuthRequestError("Upstream request timed out.", 408);
    const { result, captureException } = harness(error);

    await act(async () => {
      await expect(
        result.current.startLogin({ kind: "github" }),
      ).rejects.toBe(error);
    });

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { action: "sign_in", domain: "auth", provider: "github" },
    });
  });

  it("continues capturing non-control auth failures", async () => {
    const error = new AuthRequestError("Cloud unavailable.", 503);
    const { result, captureException } = harness(error);

    await act(async () => {
      await expect(
        result.current.startLogin({ kind: "github" }),
      ).rejects.toBe(error);
    });

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { action: "sign_in", domain: "auth", provider: "github" },
    });
  });
});
