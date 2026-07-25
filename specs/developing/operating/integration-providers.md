# Integration Providers

How to add, change, or remove the third-party integration providers users can
connect (Linear, Slack, Sentry, ...). Architecture, account model, and the
gateway call path: [integrations.md](../../codebase/platforms/product/integrations.md).

Applies to hosted staging/production and self-hosted deployments alike:
providers ship as code, so every environment converges on the next deploy.
Permissions: repo write for tier 1; environment-variable/secret admin plus a
developer app in the provider's console for tier 2. The org-custom path at the
end needs no deploy at all, only an organization admin.

A provider must expose a hosted MCP server. The gateway speaks MCP to the
provider; there is no REST-adapter path. If the service has no MCP endpoint,
there is nothing to add yet.

## Tier 1: add a provider (code-only PR)

The common case. A provider whose MCP server uses either plain API-key auth
or OAuth with RFC 7591 dynamic client registration needs one data entry and
no provider-specific code. Of the current seeds, 12 of 13 fit this tier;
Slack is the exception (tier 2).

1. Add a `SeedDefinition` to `SEED_DEFINITIONS` in
   `server/proliferate/server/cloud/integrations/seeds.py`:
   - `namespace`: the permanent identifier. It keys accounts, policy rows,
     and tool-call audit rows; it never changes after ship.
   - `auth_kind`: `api_key`, `oauth2`, or `none`.
   - `oauth_client_mode`: `"dcr"` for OAuth providers (Cloud self-registers a
     client against the provider's authorization server on first use);
     tier 2 covers `"static"`.
   - `config`: the declarative launch config (`IntegrationConfig` in
     `config.py`): MCP URL, header/query templates with `{secret.X}` and
     `{settings.X}` placeholders, secret/setting fields for the connect
     form, optional OAuth scopes and scope policy.
   The connect dialog, catalog and health APIs, credential encryption, and
   header rendering are all driven from this one record; nothing else in the
   server changes.
2. Update the seed-count literals in
   `server/tests/integration/test_integration_provider_access.py` (three
   `len(...) == N` assertions) and add the namespace to the catalog/health
   test expectations where they enumerate seeds.
3. Optional but expected for launch: add the provider icon under
   `apps/packages/product-client/src/assets/connector-icons/` and register it
   in `IntegrationIcon.tsx` (`INTEGRATION_ICON_IMAGES` or
   `INTEGRATION_GLYPHS`), plus the namespace lists in
   `IntegrationIcon.test.tsx`. Unknown namespaces fall back to a generic
   plug glyph, so this can trail the server PR.
4. Deploy. `sync_seed_definitions` runs at every server boot and upserts
   seeds by namespace into `cloud_integration_definition`, so the provider
   appears in every environment's catalog on its next deploy with no
   migration or seed script.

Verify per [Verification](#verification).

## Tier 2: a provider needing static OAuth or a tool policy

Two independent reasons a provider is more than a seed entry. Slack is
currently the only provider with either.

### Static OAuth client (no DCR support)

The provider requires a pre-registered developer app instead of dynamic
client registration.

1. Create the app in the provider's console with the redirect URL
   `<api_base_url>/v1/cloud/integrations/oauth/callback`.
2. Add settings to `server/proliferate/config.py` following the Slack
   pattern (`cloud_mcp_<provider>_enabled`, `_client_id`, `_client_secret`,
   `_token_endpoint_auth_method`) and register them in
   `specs/developing/reference/env-vars.yaml`.
3. Branch on the namespace in `_static_oauth_client_config`
   (`server/proliferate/server/cloud/integrations/oauth/clients.py`) and set
   `oauth_client_mode="static"` on the seed.
4. Set the environment variables in each deployment. Until they are set, a
   `static`-mode definition resolves no OAuth client and connect fails; the
   `_enabled` flag doubles as the kill switch.

### Tool policy (mixed read/mutating tool surface)

By default every tool a provider's MCP server exposes is callable by any
agent holding a ready account. When a provider mixes reads with external
actions (posting messages, editing data), it needs an exact-name policy in
`server/proliferate/server/cloud/integration_gateway/domain/tool_policy.py`:
a read allowlist, a mutating list that routes into the durable
approval flow, and deny-by-default for unknown names. Matching is
case-sensitive on the canonical `(provider, tool)` pair and never inspects
arguments. See the Slack sets there for the pattern, and note the approval
flow currently stops before delivery (see the frozen delivery slice in
[integrations.md](../../codebase/platforms/product/integrations.md)); a new
policied provider makes its mutating tools requestable, not executable.

## Change or remove a provider

- Changing a seed's display fields, config, or scopes is a tier 1 PR; the
  boot-time upsert overwrites the mutable fields by namespace. Existing
  accounts keep working unless the auth shape changed; a scope change under
  an `exact` scope policy forces reauthentication on next use by design.
- Removing a seed from `SEED_DEFINITIONS` archives it at next boot
  (`archived_at` is set; org-custom rows are never touched). Archived
  definitions drop out of the catalog and the gateway's account resolution,
  but account rows and their encrypted credentials remain until users delete
  them. Re-adding the namespace un-archives in place.
- Never reuse a namespace for a different service: audit rows
  (`cloud_integration_tool_call_event`) and approval snapshots reference it
  as history.

## Org-custom definitions (no deploy)

Organization admins can register any MCP URL as an `org_custom` definition
through Settings (`POST /v1/cloud/integrations/admin/organizations/{org}/definitions`).
Cloud probes the URL for OAuth support and stores the same definition shape,
scoped to the org and cascade-deleted with it. This is the path for internal
or niche MCP servers; the seed path above is for providers every deployment
should offer.

## Verification

1. `GET /v1/cloud/integrations/catalog` (user-authenticated) lists the new
   namespace with the expected connect-form schema.
2. Connect an account in Settings; for OAuth confirm the flow reaches the
   provider consent page and lands the account in `ready`; check
   `GET /v1/cloud/integrations/health`.
3. Through a live session (or the gateway MCP endpoint with a real worker
   bearer): `integrations.list_providers` includes the namespace,
   `integrations.list_tools` returns the provider's tools, and one
   representative `integrations.call_tool` round-trips. Each call writes a
   `cloud_integration_tool_call_event` row; check it records success.
4. For a tool-policied provider, also assert one denied tool name fails
   closed and one mutating tool returns `integration_tool_approval_required`.

## Failure modes

- Provider missing from the catalog after deploy: the server did not boot
  (seed sync runs in app lifespan), or the namespace collides with an
  archived row that failed to un-archive. Check server startup logs for the
  seed-sync line.
- OAuth connect fails immediately for a `static` provider: the environment
  variables are unset or the `_enabled` flag is false; the definition
  resolves no client.
- OAuth connect fails for a `dcr` provider: the provider's authorization
  server rejected dynamic registration; the provider likely needs the
  static-client path.
- Tools list but every call 401s with `integration_reauth_required`: token
  refresh is failing (missing refresh token or scope-policy violation); the
  user must reconnect the account.
- A seed edit did not take effect: seeds upsert at boot, so a config change
  requires a server restart locally (`make dev` picks it up on reload) and a
  deploy in cloud.

Secrets policy: the shared rules in [README.md](README.md) apply. Provider
developer-app secrets live only in environment configuration; user
credentials exist only as ciphertext in `cloud_integration_account` and are
never logged or returned by any API.
