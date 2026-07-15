// Product-owned sign-in option shapes. Relocated from the retained Desktop host
// auth transport (`lib/integrations/auth/proliferate-auth[-sso-auth]`) so the
// moved sign-in workflow hooks (`use-github-sign-in`, `use-sso-sign-in`) can
// name their `signIn(options)` parameter without reaching back into the host.
// The host re-imports these through the `internal/*` reverse seam so its own
// auth machinery keeps a single definition.

export interface GitHubDesktopSignInOptions {
  prompt?: "select_account";
}

export interface DesktopSsoSignInOptions {
  email?: string | null;
  organizationId?: string | null;
  connectionId?: string | null;
  prompt?: "select_account";
}
