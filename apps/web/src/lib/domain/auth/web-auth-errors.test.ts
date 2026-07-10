import { describe, expect, it } from "vitest";

import {
  isWebBetaAuthErrorCode,
  webAuthErrorPresentation,
  webBetaAuthErrorCode,
} from "./web-auth-errors";

describe("web auth errors", () => {
  it("presents beta denials as no cloud account errors", () => {
    const presentation = webAuthErrorPresentation("web_beta_email_not_allowed");

    expect(isWebBetaAuthErrorCode("web_beta_email_not_allowed")).toBe(true);
    expect(presentation.title).toBe("No cloud account");
    expect(presentation.statusLabel).toBe("Beta only");
    expect(presentation.primaryAction.kind).toBe("open_desktop");
    expect(presentation.secondaryAction?.kind).toBe("try_again");
  });

  it("extracts only beta auth error codes from thrown errors", () => {
    expect(webBetaAuthErrorCode({ code: "web_beta_email_missing" })).toBe(
      "web_beta_email_missing",
    );
    expect(webBetaAuthErrorCode({ code: "github_link_required" })).toBeNull();
    expect(webBetaAuthErrorCode(new Error("failed"))).toBeNull();
  });

  it("presents SSO domain denials as actionable setup errors", () => {
    const presentation = webAuthErrorPresentation("sso_email_domain_not_allowed");

    expect(presentation.title).toBe("Account not allowed");
    expect(presentation.statusLabel).toBe("SSO access denied");
    expect(presentation.description).toContain("approved email domains");
    expect(presentation.primaryAction.kind).toBe("try_again");
  });

  it("presents OIDC token exchange failures without exposing raw details", () => {
    const presentation = webAuthErrorPresentation("sso_oidc_token_exchange_failed");

    expect(presentation.title).toBe("SSO setup issue");
    expect(presentation.statusLabel).toBe("Token exchange failed");
    expect(presentation.description).toContain("client secret");
  });

  it("presents org SSO membership denials as invite-required errors", () => {
    const presentation = webAuthErrorPresentation("sso_user_not_team_member");

    expect(presentation.title).toBe("Invite required");
    expect(presentation.statusLabel).toBe("SSO access denied");
    expect(presentation.description).toContain("existing organization members");
  });

  it("presents JIT-disabled rejections with an actionable admin fix", () => {
    // A first-time SSO user under the default SSO_JIT_POLICY=disabled reaches
    // this screen (code sso_jit_disabled) instead of a generic dead-end.
    const presentation = webAuthErrorPresentation("sso_jit_disabled");

    expect(presentation.title).toBe("Account not provisioned");
    expect(presentation.statusLabel).toBe("SSO access denied");
    expect(presentation.description).toContain("just-in-time provisioning");
    expect(presentation.primaryAction.kind).toBe("try_again");
  });
});
