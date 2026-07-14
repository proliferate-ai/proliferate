import { describe, expect, it } from "vitest";
import { productAuthIssueMessage } from "./product-auth-issue-presentation";

describe("productAuthIssueMessage", () => {
  it("explains deployment reachability failures", () => {
    expect(productAuthIssueMessage({ kind: "deployment_unreachable" })).toBe(
      "Could not reach this Proliferate server. Check the server address and try again.",
    );
  });

  it("preserves the access-denial code in the user-facing failure", () => {
    expect(productAuthIssueMessage({ kind: "access_denied", code: "seat_required" })).toBe(
      "This account cannot access the product (seat_required).",
    );
  });

  it.each([
    ["provider_error", "Authentication was cancelled or rejected by the provider."],
    ["malformed_callback", "Authentication returned an invalid callback. Start again."],
    ["state_mismatch", "Authentication received a callback from a different sign-in attempt."],
    ["expired", "Authentication expired. Start again."],
    ["exchange_failed", "Authentication could not be completed. Start again."],
    ["already_consumed", "This authentication callback was already handled."],
  ] as const)("explains the %s callback failure", (reason, expected) => {
    expect(productAuthIssueMessage({ kind: "callback_failed", reason })).toBe(expected);
  });
});
