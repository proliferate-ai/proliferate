# Local SSO Auth Profiles

Local OIDC provider credentials live here for manual SSO QA. Real files are
ignored; create one file per provider:

```bash
.auth-env/.env.google
.auth-env/.env.auth0
.auth-env/.env.okta
.auth-env/.env.microsoft
```

Each file should export the normal deployment SSO env vars, for example:

```bash
PROLIFERATE_SSO_ENABLED=true
PROLIFERATE_SSO_PROTOCOL=oidc
PROLIFERATE_SSO_DISPLAY_NAME="Google SSO"
# Leave blank for manual provider-only QA, or set a comma-separated allowlist.
PROLIFERATE_SSO_ALLOWED_DOMAINS="example.com"
PROLIFERATE_SSO_OIDC_ISSUER_URL="https://accounts.google.com"
PROLIFERATE_SSO_OIDC_CLIENT_ID="..."
PROLIFERATE_SSO_OIDC_CLIENT_SECRET="..."
PROLIFERATE_SSO_OIDC_SCOPES="openid email profile"
PROLIFERATE_SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD="client_secret_basic"
# Optional: override only the OIDC redirect URI base for providers that require
# a different loopback hostname than the local API base URL.
PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL="http://localhost:${PROLIFERATE_API_PORT}"
# Only set this for local/private IdPs. Public providers should leave it false.
PROLIFERATE_SSO_OIDC_ALLOW_PRIVATE_PROVIDER_URLS=false
```

Run deployment/self-hosted SSO with:

```bash
make dev PROFILE=sso-google AUTH_PROFILE=google
```

Seed an org-scoped local SSO connection with:

```bash
make seed-sso PROFILE=sso-org AUTH_PROFILE=google ORG_ID=<org-id>
```
