import { AuthProviderButton, ProviderBrandIcon } from "@proliferate/ui";

/**
 * The five provider kinds. `password` and `sso` fall back to the DS's own
 * Mail / Shield glyphs; github, google and apple are inline brand marks.
 */
export const ProviderKinds = () => (
  <div className="flex flex-col gap-3 p-2">
    {[
      { provider: "github", label: "GitHub" },
      { provider: "google", label: "Google" },
      { provider: "apple", label: "Apple" },
      { provider: "sso", label: "SAML SSO" },
      { provider: "password", label: "Email and password" },
    ].map((entry) => (
      <div key={entry.provider} className="flex items-center gap-3">
        <span className="flex size-6 items-center justify-center text-foreground">
          <ProviderBrandIcon provider={entry.provider} />
        </span>
        <span className="text-ui text-foreground">{entry.label}</span>
        <span className="text-ui-sm text-faint">provider="{entry.provider}"</span>
      </div>
    ))}
  </div>
);

/**
 * With `provider="sso"` the `label` picks the brand: the connection name is
 * matched against auth0 / gitlab / google / microsoft / okta, and anything
 * else keeps the generic shield.
 */
export const SsoBrandsFromLabel = () => (
  <div className="flex flex-col gap-3 p-2">
    {[
      "Okta",
      "Auth0",
      "GitLab",
      "Microsoft Entra ID",
      "Google Workspace",
      "Acme Robotics IdP",
    ].map((label) => (
      <div key={label} className="flex items-center gap-3">
        <span className="flex size-6 items-center justify-center text-foreground">
          <ProviderBrandIcon provider="sso" label={label} />
        </span>
        <span className="text-ui text-foreground">{label}</span>
      </div>
    ))}
  </div>
);

/** Where it ships: the leading glyph of each sign-in button. */
export const InSignInButtons = () => (
  <div className="flex w-full max-w-md flex-col gap-3 p-2">
    <AuthProviderButton icon={<ProviderBrandIcon provider="github" />} variant="primary">
      Continue with GitHub
    </AuthProviderButton>
    <AuthProviderButton icon={<ProviderBrandIcon provider="google" />}>
      Continue with Google
    </AuthProviderButton>
    <AuthProviderButton icon={<ProviderBrandIcon provider="apple" />}>
      Continue with Apple
    </AuthProviderButton>
    <AuthProviderButton icon={<ProviderBrandIcon provider="sso" label="Okta" />}>
      Continue with Okta
    </AuthProviderButton>
    <AuthProviderButton icon={<ProviderBrandIcon provider="password" />}>
      Continue with email
    </AuthProviderButton>
  </div>
);

/** `className` replaces the default `icon-control` sizing. */
export const SizeOverrides = () => (
  <div className="flex items-end gap-6 p-4 text-foreground">
    {["icon-paired", "icon-control", "size-8", "size-12"].map((size) => (
      <div key={size} className="flex flex-col items-center gap-2">
        <ProviderBrandIcon provider="github" className={size} />
        <span className="text-ui-sm text-muted-foreground">{size}</span>
      </div>
    ))}
  </div>
);
