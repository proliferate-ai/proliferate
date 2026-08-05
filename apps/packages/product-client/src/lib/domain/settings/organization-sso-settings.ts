import type {
  OrganizationSsoConnectionRequest,
  OrganizationSsoConnectionResponse,
  OrganizationSsoConnectionUpdateRequest,
} from "@proliferate/cloud-sdk/types";

export interface OrganizationSsoSettingsForm {
  displayName: string;
  allowedDomains: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcScopes: string;
  oidcTokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
}

export interface OrganizationSsoConnectionPresentation {
  id: string;
  status: "draft" | "enabled" | "disabled";
  displayName: string;
  oidcRedirectUri: string;
  oidcClientSecretConfigured: boolean;
  testedAt?: string | null;
  lastError?: string | null;
}

export const EMPTY_ORGANIZATION_SSO_FORM: OrganizationSsoSettingsForm = {
  displayName: "Company SSO",
  allowedDomains: "",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid email profile",
  oidcTokenEndpointAuthMethod: "client_secret_basic",
};

export function organizationSsoConnectionPresentation(
  connection: OrganizationSsoConnectionResponse,
): OrganizationSsoConnectionPresentation {
  return {
    id: connection.id,
    status: connection.status,
    displayName: connection.displayName,
    oidcRedirectUri: connection.oidcRedirectUri,
    oidcClientSecretConfigured: connection.oidcClientSecretConfigured,
    testedAt: connection.testedAt,
    lastError: connection.lastError,
  };
}

export function organizationSsoFormFromConnection(
  connection: OrganizationSsoConnectionResponse,
): OrganizationSsoSettingsForm {
  return {
    displayName: connection.displayName,
    allowedDomains: connection.allowedDomains.join(", "),
    oidcIssuerUrl: connection.oidcIssuerUrl ?? "",
    oidcClientId: connection.oidcClientId ?? "",
    oidcClientSecret: "",
    oidcScopes: connection.oidcScopes.join(" "),
    oidcTokenEndpointAuthMethod: connection.oidcTokenEndpointAuthMethod,
  };
}

export function organizationSsoCreateRequestFromForm(
  form: OrganizationSsoSettingsForm,
): OrganizationSsoConnectionRequest {
  return {
    protocol: "oidc",
    displayName: form.displayName,
    loginPolicy: "optional",
    jitPolicy: "disabled",
    defaultRole: "member",
    allowedDomains: splitList(form.allowedDomains),
    oidcIssuerUrl: form.oidcIssuerUrl.trim() || null,
    oidcClientId: form.oidcClientId.trim() || null,
    oidcClientSecret: form.oidcClientSecret.trim() || null,
    oidcScopes: splitScopes(form.oidcScopes),
    oidcTokenEndpointAuthMethod: form.oidcTokenEndpointAuthMethod,
  };
}

export function organizationSsoUpdateRequestFromForm(
  form: OrganizationSsoSettingsForm,
): OrganizationSsoConnectionUpdateRequest {
  const request: OrganizationSsoConnectionUpdateRequest = {
    displayName: form.displayName,
    allowedDomains: splitList(form.allowedDomains),
    oidcIssuerUrl: form.oidcIssuerUrl.trim() || null,
    oidcClientId: form.oidcClientId.trim() || null,
    oidcScopes: splitScopes(form.oidcScopes),
    oidcTokenEndpointAuthMethod: form.oidcTokenEndpointAuthMethod,
  };
  if (form.oidcClientSecret.trim()) {
    request.oidcClientSecret = form.oidcClientSecret.trim();
  }
  return request;
}

export function isOrganizationSsoFormDirty(
  form: OrganizationSsoSettingsForm,
  connection: OrganizationSsoConnectionResponse,
): boolean {
  return form.displayName !== connection.displayName
    || splitList(form.allowedDomains).join(",") !== connection.allowedDomains.join(",")
    || (form.oidcIssuerUrl.trim() || null) !== connection.oidcIssuerUrl
    || form.oidcClientId.trim() !== (connection.oidcClientId ?? "")
    || form.oidcClientSecret.trim().length > 0
    || splitScopes(form.oidcScopes).join(" ") !== connection.oidcScopes.join(" ")
    || form.oidcTokenEndpointAuthMethod !== connection.oidcTokenEndpointAuthMethod;
}

export function organizationSsoErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "SSO settings could not be loaded.";
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function splitScopes(value: string): string[] {
  return value.replaceAll(",", " ").split(/\s+/u).map((item) => item.trim()).filter(Boolean);
}
