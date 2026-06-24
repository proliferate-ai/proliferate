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
});
