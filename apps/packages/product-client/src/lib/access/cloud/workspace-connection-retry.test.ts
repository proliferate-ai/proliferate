import { AnyHarnessError } from "@anyharness/sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  getCloudWorkspaceBillingBlockFromError,
  retryCloudWorkspaceRequest,
} from "#product/lib/access/cloud/workspace-connection-retry";

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
