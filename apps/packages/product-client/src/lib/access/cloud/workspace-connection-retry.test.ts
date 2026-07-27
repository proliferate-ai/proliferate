import { AnyHarnessError } from "@anyharness/sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES,
  CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS,
  CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
  CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  cloudWorkspaceConnectionRetryBudget,
  getCloudWorkspaceBillingBlockFromError,
  isCloudSandboxRuntimeProvisioningError,
  isCloudWorkspaceNotReadyError,
  isRetryableCloudWorkspaceConnectionError,
  retryCloudWorkspaceRequest,
} from "#product/lib/access/cloud/workspace-connection-retry";

function runtimeNotReadyError(): ProliferateClientError {
  return new ProliferateClientError(
    "Cloud sandbox runtime access is not ready.",
    409,
    "cloud_sandbox_runtime_not_ready",
  );
}

function workspaceNotReadyError(): ProliferateClientError {
  return new ProliferateClientError(
    "Cloud workspace is not ready.",
    409,
    "workspace_not_ready",
  );
}

describe("cloud workspace connection errors", () => {
  it("maps the preserved gateway 402 detail into a start block", () => {
    const error = new AnyHarnessError(
      {
        type: "about:blank",
        title: "Payment Required",
        status: 402,
      },
      undefined,
      {
        code: "billing_credits_exhausted",
        message: "Cloud credits are exhausted.",
        decision_type: "deny",
        reason: "credits_exhausted",
      },
    );

    expect(getCloudWorkspaceBillingBlockFromError(error)).toEqual({
      code: "billing_credits_exhausted",
      startBlockReason: "credits_exhausted",
    });
  });

  it("does not retry a 402 through the flat connection policy", async () => {
    const error = new ProliferateClientError(
      "Cloud usage is blocked.",
      402,
      "billing_start_blocked",
      { reason: "admin_hold" },
    );
    const request = vi.fn().mockRejectedValue(error);

    await expect(retryCloudWorkspaceRequest(
      request,
      "Failed to connect to cloud workspace.",
    )).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("cloud workspace connection retry classification", () => {
  it("treats the runtime-provisioning 409 as a not-ready, retryable error", () => {
    const error = runtimeNotReadyError();

    expect(isCloudSandboxRuntimeProvisioningError(error)).toBe(true);
    expect(isCloudWorkspaceNotReadyError(error)).toBe(true);
    expect(isRetryableCloudWorkspaceConnectionError(error)).toBe(true);
  });

  it("keeps workspace_not_ready on the generic budget", () => {
    const error = workspaceNotReadyError();

    expect(isCloudSandboxRuntimeProvisioningError(error)).toBe(false);
    expect(isCloudWorkspaceNotReadyError(error)).toBe(true);
    expect(cloudWorkspaceConnectionRetryBudget(error)).toEqual({
      maxRetries: CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
      delayMs: CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
    });
  });

  it("does not classify other conflict codes as provisioning", () => {
    const error = new ProliferateClientError(
      "Cloud sandbox is missing.",
      409,
      "cloud_sandbox_missing",
    );

    expect(isCloudSandboxRuntimeProvisioningError(error)).toBe(false);
    expect(isCloudWorkspaceNotReadyError(error)).toBe(false);
    expect(isRetryableCloudWorkspaceConnectionError(error)).toBe(false);
  });

  it("grants the provisioning budget enough runway for a 30-60s cold repair", () => {
    const budget = cloudWorkspaceConnectionRetryBudget(runtimeNotReadyError());

    expect(budget).toEqual({
      maxRetries: CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES,
      delayMs: CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS,
    });
    expect(budget.maxRetries * budget.delayMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe("retryCloudWorkspaceRequest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps retrying a runtime-provisioning 409 past the generic budget until it succeeds", async () => {
    vi.useFakeTimers();
    const failuresBeforeSuccess = CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES + 4;
    let attempts = 0;
    const request = vi.fn(async () => {
      attempts += 1;
      if (attempts <= failuresBeforeSuccess) {
        throw runtimeNotReadyError();
      }
      return "connected";
    });

    const result = retryCloudWorkspaceRequest(request, "Failed to connect.");
    await vi.advanceTimersByTimeAsync(
      failuresBeforeSuccess * CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS,
    );

    await expect(result).resolves.toBe("connected");
    expect(request).toHaveBeenCalledTimes(failuresBeforeSuccess + 1);
  });

  it("stops retrying workspace_not_ready after the generic budget", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => {
      throw workspaceNotReadyError();
    });

    const result = retryCloudWorkspaceRequest(request, "Failed to connect.");
    const rejection = expect(result).rejects.toMatchObject({
      code: "workspace_not_ready",
    });
    await vi.advanceTimersByTimeAsync(
      (CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES + 1)
      * CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
    );

    await rejection;
    expect(request).toHaveBeenCalledTimes(CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES + 1);
  });

  it("surfaces the provisioning error once its own budget is exhausted", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => {
      throw runtimeNotReadyError();
    });

    const result = retryCloudWorkspaceRequest(request, "Failed to connect.");
    const rejection = expect(result).rejects.toMatchObject({
      code: "cloud_sandbox_runtime_not_ready",
    });
    await vi.advanceTimersByTimeAsync(
      (CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES + 1)
      * CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS,
    );

    await rejection;
    expect(request).toHaveBeenCalledTimes(
      CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES + 1,
    );
  });

  it("does not retry non-retryable errors", async () => {
    const request = vi.fn(async () => {
      throw new ProliferateClientError("Not found.", 404, "workspace_not_found");
    });

    await expect(
      retryCloudWorkspaceRequest(request, "Failed to connect."),
    ).rejects.toMatchObject({ code: "workspace_not_found" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
