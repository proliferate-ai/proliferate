import { describe, expect, it } from "vitest";
import type { OrganizationSsoConnectionResponse } from "@proliferate/cloud-sdk/types";
import {
  isOrganizationSsoFormDirty,
  organizationSsoConnectionPresentation,
  organizationSsoCreateRequestFromForm,
  organizationSsoErrorMessage,
  organizationSsoFormFromConnection,
  organizationSsoUpdateRequestFromForm,
} from "#product/lib/domain/settings/organization-sso-settings";

function connection(
  overrides: Partial<OrganizationSsoConnectionResponse> = {},
): OrganizationSsoConnectionResponse {
  return {
    id: "sso-1",
    organizationId: "org-1",
    scope: "organization",
    protocol: "oidc",
    status: "draft",
    displayName: "Example SSO",
    loginPolicy: "optional",
    jitPolicy: "disabled",
    defaultRole: "member",
    allowedDomains: ["example.com", "example.org"],
    oidcIssuerUrl: "https://id.example.com",
    oidcClientId: "client-1",
    oidcClientSecretConfigured: true,
    oidcScopes: ["openid", "email", "profile"],
    oidcTokenEndpointAuthMethod: "client_secret_basic",
    oidcRedirectUri: "https://app.example.com/sso/callback",
    samlIdpMetadataXmlConfigured: false,
    samlX509CertConfigured: false,
    samlAcsUrl: "",
    samlEntityId: "",
    samlMetadataUrl: "",
    testedAt: null,
    lastError: null,
    createdAt: "2026-08-05T00:00:00Z",
    updatedAt: "2026-08-05T00:00:00Z",
    ...overrides,
  };
}

describe("organization SSO settings model", () => {
  it("projects connection and normalized editable form state", () => {
    const record = connection({ status: "enabled", testedAt: "2026-08-05T01:00:00Z" });

    expect(organizationSsoConnectionPresentation(record)).toEqual({
      id: "sso-1",
      status: "enabled",
      displayName: "Example SSO",
      oidcRedirectUri: "https://app.example.com/sso/callback",
      oidcClientSecretConfigured: true,
      testedAt: "2026-08-05T01:00:00Z",
      lastError: null,
    });
    expect(organizationSsoFormFromConnection(record)).toEqual({
      displayName: "Example SSO",
      allowedDomains: "example.com, example.org",
      oidcIssuerUrl: "https://id.example.com",
      oidcClientId: "client-1",
      oidcClientSecret: "",
      oidcScopes: "openid email profile",
      oidcTokenEndpointAuthMethod: "client_secret_basic",
    });
  });

  it("normalizes create input while preserving the established defaults", () => {
    const form = organizationSsoFormFromConnection(connection());
    const request = organizationSsoCreateRequestFromForm({
      ...form,
      allowedDomains: " example.com, , example.org ",
      oidcScopes: "openid, email   profile",
      oidcClientSecret: " secret ",
    });

    expect(request).toMatchObject({
      protocol: "oidc",
      loginPolicy: "optional",
      jitPolicy: "disabled",
      defaultRole: "member",
      allowedDomains: ["example.com", "example.org"],
      oidcScopes: ["openid", "email", "profile"],
      oidcClientSecret: "secret",
    });
  });

  it("omits a blank update secret and treats any nonblank secret as dirty", () => {
    const record = connection();
    const form = organizationSsoFormFromConnection(record);

    expect(isOrganizationSsoFormDirty(form, record)).toBe(false);
    expect(organizationSsoUpdateRequestFromForm(form)).not.toHaveProperty("oidcClientSecret");

    const withSecret = { ...form, oidcClientSecret: " replacement " };
    expect(isOrganizationSsoFormDirty(withSecret, record)).toBe(true);
    expect(organizationSsoUpdateRequestFromForm(withSecret)).toHaveProperty(
      "oidcClientSecret",
      "replacement",
    );
  });

  it("converts errors without leaking unknown values", () => {
    expect(organizationSsoErrorMessage(null)).toBeNull();
    expect(organizationSsoErrorMessage(new Error("offline"))).toBe("offline");
    expect(organizationSsoErrorMessage({ detail: "sensitive" })).toBe(
      "SSO settings could not be loaded.",
    );
  });
});
