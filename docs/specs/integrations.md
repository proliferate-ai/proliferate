# Integrations — System Spec

## 1. Scope & Purpose

### In Scope
- External connectivity lifecycle for org-scoped OAuth integrations (`nango`, `github-app`) and Slack workspace installations.
- OAuth session creation and callback persistence for Sentry, Linear, and optional GitHub-via-Nango.
- GitHub App installation callback persistence and lifecycle webhook state reconciliation.
- Nango auth/sync webhook reconciliation for integration status.
- Token resolution primitives for downstream runtimes (`getToken`, `resolveTokens`, `getIntegrationsForTokens`, `getEnvVarName`).
- Integration list/update/disconnect behavior, including visibility filtering and creator/admin permissions.
- Slack installation lifecycle (OAuth install, status, disconnect, support-channel setup, config strategy).
- Sentry/Linear metadata read APIs used during trigger/action configuration.
- Org-scoped MCP connector catalog lifecycle (CRUD, atomic secret provisioning, validation preflight).
- Integration request intake (`requestIntegration`) and connector/tooling support endpoints (`slackMembers`, `slackChannels`).

### Out of Scope
- Trigger runtime ingestion, normalization, dispatch, and polling ownership. See `docs/specs/triggers.md`.
- Action execution, grants, approvals, and risk enforcement for connector-backed tools. See `docs/specs/actions.md`.
- Session runtime behavior that consumes integration tokens. See `docs/specs/sessions-gateway.md`.
- Automation run behavior that consumes integration bindings/tokens. See `docs/specs/automations-runs.md`.
- Repo lifecycle beyond integration binding/orphan signaling. See `docs/specs/repos-prebuilds.md`.

### Mental Models
- Integrations is a control plane, not an execution plane: it stores connectivity references and resolves credentials; it does not run external actions itself.
- There are three credential substrates:
  - Nango-managed OAuth references in `integrations` (`provider="nango"`).
  - GitHub App installation references in `integrations` (`provider="github-app"`).
  - Slack bot credentials in `slack_installations` (encrypted token at rest), plus connector auth that resolves via org secrets.
- Provider modules are declarative capability descriptors (`ConnectionRequirement`), while broker wiring lives in integrations framework code.
- Webhooks/callbacks are state-reconciliation channels, not the source of runtime business logic.
- Connector catalog ownership is split intentionally: Integrations owns configuration persistence; Actions owns runtime tool execution policy.

### Things Agents Get Wrong
- GitHub does not have a single auth path. Default is GitHub App; Nango GitHub is optional behind `NEXT_PUBLIC_USE_NANGO_GITHUB` (`apps/web/src/lib/nango.ts`).
- Slack OAuth is not stored in `integrations`; it is stored in `slack_installations` (`packages/db/src/schema/slack.ts`).
- Nango OAuth callback persistence is an authenticated oRPC mutation (`integrations.callback`), not a public provider webhook endpoint (`apps/web/src/server/routers/integrations.ts`).
- `apps/web/src/app/api/webhooks/nango/route.ts` handles auth/sync reconciliation only; `forward` payloads are acknowledged as migrated to trigger-service.
- `apps/web/src/app/api/webhooks/github-app/route.ts` handles installation lifecycle only; non-installation events are acknowledged and not processed there.
- Visibility is enforced at SQL query time in `listByOrganization`, not in UI mappers (`packages/services/src/integrations/db.ts`).
- Disconnect authorization is not admin-only: members may disconnect only integrations they created (`apps/web/src/server/routers/integrations.ts:disconnect`).
- Integration callback persistence is idempotent by `connectionId`; re-auth updates status to `active` (`packages/services/src/integrations/service.ts:saveIntegrationFromCallback`).
- Nango-managed OAuth access tokens are never persisted locally; they are fetched from Nango at use time (`packages/services/src/integrations/tokens.ts`).
- Slack disconnect is best-effort upstream revocation: local status is still revoked even if Slack revoke fails.
- Connector validation is a preflight (`tools/list`) with diagnostics; it is not runtime policy enforcement.
- `getToken()` is the runtime token boundary for consumers; direct token reads from DB are not a supported pattern.

---

## 2. Core Concepts

### 2.1 Integration Record Types
- `integrations.provider` distinguishes auth mechanism:
  - `"nango"` for Nango-managed OAuth connections.
  - `"github-app"` for GitHub App installations.
- `integrationId` identifies the provider config key (`sentry`, `linear`, env-driven GitHub integration ID, or `github-app`).
- `connectionId` is the durable lookup key for token resolution (Nango connection ID or `github-app-{installationId}`).
- `status` is lifecycle state used by status endpoints and webhook reconciliation (`active`, `error`, `deleted`, `suspended`, etc.).
- Evidence: `packages/services/src/integrations/db.ts`, `packages/services/src/integrations/service.ts`, `packages/db/src/schema/integrations.ts`.

### 2.2 Provider Declarations vs Broker Mapping
- Provider modules declare abstract connection requirements via `ConnectionRequirement` (`type`, `preset`, optional label).
- Integrations framework maps those presets to concrete Nango integration IDs and session endpoints.
- Broker-specific SDK logic is intentionally outside provider action modules.
- Evidence: `packages/providers/src/types.ts`, `apps/web/src/lib/nango.ts`, `apps/web/src/server/routers/integrations.ts`.

### 2.3 OAuth Session Surfaces
- Session creation endpoints (`githubSession`, `sentrySession`, `linearSession`) are admin/owner-gated and return Nango connect session tokens.
- Callback persistence endpoint (`callback`) is also admin/owner-gated and writes integration references only.
- Evidence: `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`.

### 2.4 GitHub Auth Topology
- GitHub App path: install callback verifies installation, upserts `github-app` integration, optionally auto-adds installation repos.
- Nango path: enabled only when `NEXT_PUBLIC_USE_NANGO_GITHUB=true`; uses Nango connect session + callback persistence.
- Evidence: `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/hooks/use-github-app-connect.ts`, `apps/web/src/lib/nango.ts`.

### 2.5 Slack Installation Topology
- Slack uses a dedicated OAuth flow and table (`slack_installations`) with encrypted bot token.
- Slack status/config/member/channel APIs operate on active installation(s) scoped to org.
- Slack disconnect revokes upstream token best-effort, then marks local installation revoked.
- Evidence: `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`.

### 2.6 Connector Catalog Topology
- Connectors are org-scoped `org_connectors` records managed via Integrations router + connectors service.
- Preset quick-setup can atomically create an org secret and connector in one DB transaction.
- Validation preflight resolves secret, calls MCP `tools/list` through Actions connector client, and returns diagnostics.
- Evidence: `packages/services/src/connectors/service.ts`, `packages/services/src/connectors/db.ts`, `apps/web/src/server/routers/integrations.ts`.

### 2.7 Token Resolution Boundary
- `getToken(integration)` chooses provider-specific retrieval:
  - GitHub App installation token (JWT + GitHub API, cached).
  - Nango connection token via `nango.getConnection`.
- `resolveTokens` deliberately returns partial successes and errors.
- `getIntegrationsForTokens` filters to active integrations in the caller org before token resolution.
- Evidence: `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`.

### 2.8 Visibility and Authorization Model
- Integration listing enforces visibility at query layer (`org`/`null` visible to all, `private` only creator).
- Sensitive mutations (`callback`, session creation, Slack connect/disconnect, connector CRUD) require admin/owner.
- Disconnect allows creator-or-admin semantics.
- Evidence: `packages/services/src/integrations/db.ts:listByOrganization`, `apps/web/src/server/routers/integrations.ts`.

Sections 3 and 4 were intentionally removed in this spec revision. File tree and data model structure are treated as code-owned source of truth.

---

## 5. Conventions & Patterns

### Do
- Keep all integration data access inside `packages/services/src/integrations/db.ts` and `packages/services/src/connectors/db.ts`.
- Keep router handlers thin and delegate business logic to services.
- Enforce org-role checks at router boundaries before mutation paths.
- Encrypt Slack bot tokens before persistence; decrypt only at call sites that need runtime API access.
- Use `getToken()` and `resolveTokens()` for runtime token retrieval flows.
- Treat connector validation as non-destructive preflight and return structured diagnostics.

### Don't
- Persist raw OAuth access tokens for Nango-managed integrations.
- Bypass org scoping for installation/connector lookup mutations.
- Couple provider action modules to Nango/GitHub/Slack SDK implementation details.
- Put connector runtime approval/risk enforcement in Integrations; that belongs to Actions.
- Route trigger forward events through web app webhook handlers during normal operation.

### Error Handling
- Normalize Nango SDK axios-shaped failures into explicit `ORPCError` messages (`handleNangoError`).
- Keep Slack revoke failures non-fatal during disconnect to prevent stuck local state.
- Return connector validation failures as `{ ok: false, diagnostics }` rather than throwing for expected connectivity/auth errors.

### Reliability
- GitHub installation tokens are cached in memory for 50 minutes in services and gateway auth helpers.
- Slack lookup/list endpoints use bounded request timeouts and pagination.
- Connector `createWithSecret` retries on unique-key races and auto-suffixes secret keys.
- Webhook handlers are idempotent status reconcilers and return success for migrated event types to avoid retry storms.

### Testing Conventions
- Prefer service-level tests for token resolution, callback idempotency, and status transitions.
- Mock Nango/GitHub/Slack/Sentry/Linear network calls in all integration tests.
- Add regression tests when touching authorization gates (`requireIntegrationAdmin`, creator-or-admin disconnect).

---

## 6. Subsystem Deep Dives

### 6.1 Integration Listing and Visibility Invariants — `Implemented`
- Listing must only return integrations in caller org.
- Visibility must be enforced in SQL (`org` + `null` visible to all members, `private` only creator).
- Provider summary booleans (`github/sentry/linear.connected`) must derive from returned visible set, not hidden rows.
- Integration update must only mutate `displayName` for an integration owned by org.
- Evidence: `packages/services/src/integrations/db.ts:listByOrganization`, `packages/services/src/integrations/service.ts:listIntegrations`, `packages/services/src/integrations/service.ts:updateIntegration`.

### 6.2 OAuth Session + Callback Invariants — `Implemented`
- `githubSession`, `sentrySession`, and `linearSession` must require admin/owner role.
- Session creation must bind Nango connect session to both end-user identity and org identity.
- GitHub Nango session endpoint must be feature-flag gated (`NEXT_PUBLIC_USE_NANGO_GITHUB`).
- Callback persistence must require admin/owner role.
- Callback persistence must be idempotent by `connectionId`; existing row must transition back to `active`.
- New callback persistence must create `integrations` row with `provider="nango"`, `status="active"`, `visibility="org"`.
- Evidence: `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`.

### 6.3 GitHub App Installation Invariants — `Implemented`
- Callback must authenticate caller (or redirect to sign-in with callback retry URL).
- OAuth start must require an admin/owner caller and mint base64url JSON state containing org/user context + nonce + timestamp + optional return URL, signed with server-side HMAC.
- Callback must reject missing, unsigned, tampered, or expired OAuth state before trusting any state fields.
- Callback must re-validate that the authenticated user is an admin/owner in the state org before persistence.
- Callback return URL must be sanitized to approved relative-path prefixes.
- Installation must be verified against GitHub API before persistence.
- Persistence must upsert by `(connectionId, organizationId)` using `connectionId = github-app-{installationId}`.
- Re-installation must reactivate status and refresh display name.
- Repo auto-add after installation is best-effort and must not block successful integration persistence.
- Evidence: `apps/web/src/app/api/integrations/github/oauth/route.ts`, `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/lib/github-app.ts`, `packages/services/src/integrations/db.ts:upsertGitHubAppInstallation`.

### 6.4 Disconnect and Orphan Handling Invariants — `Implemented`
- Disconnect must fail if integration is missing or not in caller org.
- Authorization: admin/owner may disconnect any; member may disconnect only rows they created.
- For Nango-backed rows, upstream Nango connection delete must be attempted before DB delete.
- For GitHub-related rows, repo orphan reconciliation must run after delete.
- Orphan reconciliation currently scans non-orphaned repos and counts repo connections per repo.
- Evidence: `apps/web/src/server/routers/integrations.ts:disconnect`, `packages/services/src/integrations/service.ts:deleteIntegration`.

### 6.5 Slack Lifecycle Invariants — `Implemented`
- Slack OAuth start must require authenticated session with active org and admin/owner role.
- OAuth state must embed org/user context + nonce + timestamp + optional relative return URL and must be HMAC-signed server-side.
- OAuth callback must reject missing params, invalid/unsigned/tampered state, and state older than 5 minutes.
- OAuth callback must re-validate that the authenticated callback user matches state user and is still an admin/owner in the state org.
- Slack token from OAuth exchange must be encrypted before persistence.
- Save path must upsert by `(organizationId, teamId)` semantics (create or reactivate/update existing install).
- Slack disconnect must mark local installation revoked even if upstream `auth.revoke` fails.
- Slack support-channel connect must persist at least support channel ID + invite URL on active install.
- Slack config updates must validate strategy constraints and org ownership of configuration IDs.
- Evidence: `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`.

### 6.6 Metadata Query Invariants (Sentry/Linear) — `Implemented`
- Metadata endpoints must only operate on integration row in caller org.
- Metadata endpoints must require integration status `active` before external API calls.
- Credentials must be pulled from live Nango connection at request time.
- Sentry metadata must return `{ projects, environments, levels }` with fixed severity level set.
- Linear metadata must return teams/states/labels/users/projects from GraphQL response.
- Evidence: `apps/web/src/server/routers/integrations.ts:sentryMetadata`, `apps/web/src/server/routers/integrations.ts:linearMetadata`.

### 6.7 Token Resolution Invariants — `Implemented`
- Runtime token resolution must flow through `getToken()` provider branching.
- GitHub App token branch must use installation token retrieval with in-memory cache.
- Nango token branch must retrieve `credentials.access_token` via `nango.getConnection`.
- `resolveTokens()` must continue on per-integration failures and surface error list.
- `getIntegrationsForTokens()` must only return active integrations in caller org.
- `getEnvVarName()` must generate deterministic token env var names from integration type + short ID.
- Evidence: `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`.

### 6.8 Connector Catalog Invariants — `Implemented`
- Connectors must be org-scoped records with explicit `enabled` state.
- Connector CRUD mutations must require admin/owner role.
- Preset-based quick setup with `secretValue` must atomically create org secret + connector.
- Transactional quick setup must resolve secret-key collisions with `_2`, `_3`, ... suffixing.
- Validation must resolve secret value then run connector `tools/list`; failure must map to diagnostics classes (`auth`, `timeout`, `unreachable`, `protocol`, `unknown`).
- Integrations owns connector persistence only; action risk/approval/grants/audit remain in Actions.
- Evidence: `apps/web/src/server/routers/integrations.ts:createConnectorWithSecret`, `apps/web/src/server/routers/integrations.ts:validateConnector`, `packages/services/src/connectors/db.ts:createWithSecret`, `packages/services/src/connectors/service.ts`.

### 6.9 Webhook Reconciliation Invariants — `Implemented`
- Nango webhook signature verification must run when `NANGO_SECRET_KEY` is configured.
- Nango `auth` webhooks must update integration status transitions (`creation|override` success => `active`, `refresh` failure => `error`).
- Nango `forward` webhooks must be acknowledged as migrated, not processed in this route.
- GitHub App webhook must verify signature and only reconcile installation lifecycle statuses (`deleted`, `suspended`, `active`).
- Non-lifecycle GitHub events must be acknowledged as migrated to trigger-service.
- Evidence: `apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`.

### 6.10 Auxiliary Endpoint Invariants — `Implemented`
- `requestIntegration` is best-effort: it returns success even when email provider is missing/failing.
- `slackMembers` and `slackChannels` must verify installation belongs to caller org before listing data.
- Slack list endpoints must use decrypted installation bot token and exclude invalid member rows where applicable.
- Evidence: `apps/web/src/server/routers/integrations.ts:requestIntegration`, `apps/web/src/server/routers/integrations.ts:slackMembers`, `apps/web/src/server/routers/integrations.ts:slackChannels`, `packages/services/src/integrations/service.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `docs/specs/actions.md` | Actions -> Integrations | `getToken()`, `resolveTokens()`, connector catalog reads | Actions consumes credentials + connector definitions; Actions owns runtime policy enforcement. |
| `docs/specs/triggers.md` | Triggers <-> Integrations | Nango/GitHub lifecycle status lookups and updates | Trigger-service owns forward event ingestion; integrations routes only reconcile auth/lifecycle state. |
| `docs/specs/sessions-gateway.md` | Sessions -> Integrations | GitHub/Nango token helpers, integration bindings | Session runtime consumes resolved credentials, not raw DB token fields. |
| `docs/specs/automations-runs.md` | Automations -> Integrations | integration bindings + token resolution | Automations use integration references for enrichment/execution context. |
| `docs/specs/repos-prebuilds.md` | Repos <-> Integrations | repo connection bindings, orphan signaling | Disconnect can mark repos orphaned if all links removed. |
| `docs/specs/secrets-environment.md` | Integrations -> Secrets | connector secret resolution and storage | Connector auth references org secrets; quick setup can create secret + connector together. |
| `docs/specs/auth-orgs.md` | Integrations -> Auth | `orgProcedure`, role lookup | All integration surfaces are org-scoped and role-gated for mutations. |
| `packages/providers` | Integrations -> Providers | `ConnectionRequirement` declarations | Provider declarations remain broker-agnostic; integrations maps presets to broker config. |

### Security & Auth
- All integration router handlers are org-scoped through `orgProcedure`.
- Mutation endpoints with credential impact enforce admin/owner checks.
- Disconnect uses explicit creator-or-admin guardrail.
- OAuth/bot secrets are never returned in API responses.
- Slack bot tokens are encrypted at rest and decrypted only for outbound Slack API calls.
- GitHub/Nango webhook handlers verify signatures when secrets are configured.

### Observability
- Integrations endpoints use structured logging with handler/module child loggers.
- Webhook handlers log lifecycle transitions and signature failures.
- Connector validation emits classified diagnostic failures for operator feedback.

---

## 8. Acceptance Gates

- [ ] Spec claims map to code paths in `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/`, `packages/services/src/connectors/`, and webhook/callback routes.
- [ ] Section 6 uses declarative invariants and rules (no imperative runbooks).
- [ ] Mental models and "things agents get wrong" are present and grounded in current code.
- [ ] No guidance suggests persisting raw OAuth tokens.
- [ ] Role and org scoping rules are explicit for every mutation class.
- [ ] Webhook boundary with trigger-service migration is explicit.
- [ ] Connector ownership split (Integrations persistence vs Actions enforcement) is explicit.

---

## 9. Known Limitations & Tech Debt

- [ ] **User-scoped credential resolution is not implemented.** `user_connections` was dropped and `getToken()` has no user-attribution branch yet. This blocks first-class user-authored external actions. Evidence: `packages/db/drizzle/0031_drop_user_connections.sql`, `packages/services/src/integrations/tokens.ts`.
- [ ] **GitHub App auth logic is duplicated across layers.** JWT/private-key import/token-cache logic exists in services, web lib, and gateway. Evidence: `packages/services/src/integrations/github-app.ts`, `apps/web/src/lib/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`.
- [ ] **Slack support-channel schema drift exists between generated and hand-written schema files.** `support_*` fields exist in `schema.ts` but are absent in `schema/slack.ts`; service code still reads/writes support fields. Evidence: `packages/db/src/schema/schema.ts`, `packages/db/src/schema/slack.ts`, `packages/services/src/integrations/db.ts`.
- [ ] **Slack support-channel mutation currently drops some inputs.** `updateSlackSupportChannel` ignores `channelName` and `inviteId` parameters (only ID + invite URL are persisted in this module). Evidence: `packages/services/src/integrations/db.ts:updateSlackSupportChannel`, `packages/services/src/integrations/service.ts:updateSlackSupportChannel`.
- [ ] **`packages/shared/src/contracts/integrations.ts` is not a full mirror of the active oRPC router surface.** Several live endpoints (connector CRUD/validate, Slack config/installations, requestIntegration) are router-only. Evidence: `packages/shared/src/contracts/integrations.ts`, `apps/web/src/server/routers/integrations.ts`.
- [ ] **Nango callback idempotency assumes globally unique `connectionId`.** Persistence lookup is by `connectionId` only, not `(orgId, providerConfigKey)`. Evidence: `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`, `packages/services/src/integrations/db.ts:findByConnectionId`.
- [ ] **Orphaned repo reconciliation is O(n) with per-repo count queries.** This can degrade with large org repo counts. Evidence: `packages/services/src/integrations/service.ts:handleOrphanedRepos`.
- [ ] **Nango webhook signature verification is bypassed when `NANGO_SECRET_KEY` is unset.** Useful for local dev but unsafe if misconfigured in shared environments. Evidence: `apps/web/src/app/api/webhooks/nango/route.ts:verifyNangoWebhook`.
- [ ] **Integration subsystem test coverage remains thin for critical edge cases.** Callback idempotency, role guards, and webhook status transitions need stronger regression coverage.
