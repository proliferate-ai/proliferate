import type { ReactNode } from "react";
import { OrganizationSsoSettingsSurface } from "@proliferate/ui";

const noop = () => {};

const HANDLERS = {
  onFormChange: noop,
  onSave: noop,
  onTest: noop,
  onEnable: noop,
  onDisable: noop,
  onDelete: noop,
  onRetry: noop,
  onCopyRedirectUri: noop,
};

const FORM = {
  displayName: "Okta — proliferate.dev",
  allowedDomains: "proliferate.dev, proliferate-ai.com",
  oidcIssuerUrl: "https://proliferate.okta.com/oauth2/default",
  oidcClientId: "0oa8x2n4kQpZrT1d5d7",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcTokenEndpointAuthMethod: "client_secret_basic" as const,
};

const CONNECTION = {
  id: "sso_7f2a",
  status: "enabled" as const,
  displayName: "Okta — proliferate.dev",
  oidcRedirectUri: "https://app.proliferate.dev/auth/sso/callback/sso_7f2a",
  oidcClientSecretConfigured: true,
  testedAt: "2026-07-27T14:02:00Z",
};

// The surface is a full settings page — taller than the 900x700 capture
// viewport at 1:1 — so each cell renders it at the width the settings pane
// gives it and scales the whole page down to fit the frame intact.
const Page = ({ children }: { children: ReactNode }) => (
  <div className="w-full" style={{ height: 640, overflow: "hidden" }}>
    <div style={{ width: 1000, transform: "scale(0.82)", transformOrigin: "top left" }}>
      {children}
    </div>
  </div>
);

export const EnabledConnection = () => (
  <Page>
    <OrganizationSsoSettingsSurface connection={CONNECTION} form={FORM} {...HANDLERS} />
  </Page>
);

export const UnsavedChanges = () => (
  <Page>
    <OrganizationSsoSettingsSurface
      connection={{ ...CONNECTION, status: "disabled", testedAt: null }}
      form={{ ...FORM, allowedDomains: "proliferate.dev", oidcScopes: "openid profile email groups" }}
      hasUnsavedChanges
      {...HANDLERS}
    />
  </Page>
);

export const NotConfigured = () => (
  <Page>
    <OrganizationSsoSettingsSurface
      connection={null}
      form={{
        displayName: "",
        allowedDomains: "",
        oidcIssuerUrl: "",
        oidcClientId: "",
        oidcClientSecret: "",
        oidcScopes: "openid profile email",
        oidcTokenEndpointAuthMethod: "client_secret_basic",
      }}
      {...HANDLERS}
    />
  </Page>
);

export const LoadFailed = () => (
  <Page>
    <OrganizationSsoSettingsSurface
      connection={CONNECTION}
      form={FORM}
      error="Could not reach the identity provider: connect ETIMEDOUT proliferate.okta.com:443"
      {...HANDLERS}
    />
  </Page>
);
