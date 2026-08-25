import { describe, expect, it } from "vitest";

import { describeAuthIssue } from "#product/lib/domain/auth/describe-auth-issue";

describe("describeAuthIssue", () => {
  it("describes an unreachable deployment", () => {
    expect(describeAuthIssue({ kind: "deployment_unreachable" })).toBe(
      "Can't reach the server. Check your connection and retry.",
    );
  });

  it("describes a known beta access denial", () => {
    expect(
      describeAuthIssue({ kind: "access_denied", code: "web_beta_email_not_allowed" }),
    ).toBe(
      "Hosted web access is currently limited to beta users. You can still use Proliferate from the desktop app.",
    );
  });

  it("describes an unknown access denial generically", () => {
    expect(describeAuthIssue({ kind: "access_denied", code: "some_future_code" })).toBe(
      "This account isn't allowed to sign in here.",
    );
  });

  it.each([
    ["state_mismatch", "That sign-in link expired or was already used. Try again."],
    ["expired", "That sign-in link expired or was already used. Try again."],
    ["already_consumed", "That sign-in link expired or was already used. Try again."],
    ["provider_error", "The sign-in provider reported an error. Try again."],
    [
      "malformed_callback",
      "The sign-in callback was missing required information. Try again.",
    ],
    ["exchange_failed", "Sign-in could not be completed. Try again."],
  ] as const)("describes callback_failed reason %s", (reason, expected) => {
    expect(describeAuthIssue({ kind: "callback_failed", reason })).toBe(expected);
  });
});
