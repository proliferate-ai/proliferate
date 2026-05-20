# 05 — Claiming

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`04-cloud-running-alignment.md`](04-cloud-running-alignment.md).

Claiming is the ownership transition where shared/unclaimed work
created by Slack, automations, or other team paths gets assigned to a
single user. It narrows Cloud-mediated control to that user and grants
Desktop a scoped direct-attach to the shared sandbox AnyHarness.

## 1. Purpose & Scope

In scope:

- `cloud_workspace_claim` table: append-only claim history; one
  active row per workspace at a time.
- Claim transitions: `shared_unclaimed → claimed`; `claimed →
  shared_unclaimed` (release); `claimed → archived` (revoke/admin
  cleanup).
- Cloud-mediated access policy: `can_view_cloud_workspace`,
  `can_interact_cloud_workspace`, `can_claim_cloud_workspace`,
  `can_request_direct_attach_token` access helpers used by every
  workspace/command endpoint.
- Workspace listing rules: personal work + claimed-by-me work; the
  unclaimed team pool; admin manage view.
- Direct-attach JWT issuance (Desktop only): short-lived RS256 JWT
  scoped to one claimed workspace/session, validated by AnyHarness.
- Cloud signing key + JWKS endpoint; AnyHarness JWT verification +
  scope check on every per-workspace route.
- Release and revoke flows + claim audit.
- `admin_managed` visibility state on `cloud_workspace_exposure` (the
  enum value was reserved by spec 04; spec 05 owns the transitions).

Out of scope:

- Web/mobile direct AnyHarness access. Cloud-mediated only. (→ spec
  08 if a future product decision changes this.)
- Slack inbound webhook (→ spec 07).
- Automation lifecycle (→ spec 06). Spec 05 ensures automation-
  created workspaces land as `shared_unclaimed` with claim eligible.
- JWKS rotation operations (key generation, key store). Spec 05
  defines the model and endpoint; ops procedures are a deployment
  doc.
- Long-lived "team session" sharing without claim. V1 is single-user
  claim. Multi-claimer is not on the roadmap.
- Migrating ownership (changing the org). Different operation;
  not claim. (→ spec 10 if this surface is ever needed.)
- Replacing the existing `automation_run_claims` executor lease.
  That is unrelated executor lifecycle and stays as-is.

## 2. Mental Model

```text
shared_unclaimed     org-owned work, visible to every org member,
                     interactable by every org member through
                     Cloud-mediated APIs.
                     No direct AnyHarness access for any user.

claim                Cloud records that one user claimed the work.
                     Atomic. Persisted in cloud_workspace_claim.

claimed              exposure.visibility flips to 'claimed'.
                     exposure.claimed_by_user_id is set.
                     Cloud-mediated interaction restricted to the
                     claiming user + admins (audit/manage only).
                     Desktop direct-attach allowed for the claiming
                     user via a scoped JWT.

release              claimer releases the claim voluntarily.
                     exposure.visibility -> shared_unclaimed.
                     Active direct-attach tokens are revoked.

revoke               admin revokes someone else's claim.
                     exposure.visibility -> shared_unclaimed (or
                     admin_managed if admin wants exclusive access
                     before reassignment).
                     Active direct-attach tokens are revoked.

admin_managed        admin holds the workspace in pre-archive limbo
                     (e.g. investigating abuse). No org member can
                     claim or interact via Cloud. Direct-attach
                     denied. Admin can still see and audit.
                     Transition to archived or back to
                     shared_unclaimed at admin's choice.
```

Two access surfaces, one set of policy:

```text
Cloud-mediated (web, mobile, Slack, automation, Desktop "cloud" path)
  -> /v1/cloud/* endpoints
  -> Cloud authority decides who can view/interact/claim/release
  -> Worker carries out the command

Desktop direct-attach
  -> Desktop holds a short-lived JWT scoped to one workspace
  -> Talks to the shared sandbox's AnyHarness over HTTP
  -> AnyHarness validates the JWT and enforces the scope
  -> Worker is unaffected; same AnyHarness session loop serializes
     prompts from Desktop + Cloud
```

Web/mobile never receive the direct-attach JWT. They keep using
Cloud-mediated commands.

## 3. Dependencies

Hard:

- Spec 00: `cloud_target_runtime_access` (Desktop reads AnyHarness
  base URL from here); `sandbox_profile_target_state` (slot fence
  used to ensure direct-attach targets a current slot).
- Spec 04: `cloud_workspace_exposure` exists with visibility enum
  including `shared_unclaimed`, `claimed`, `admin_managed`,
  `archived` and `claimed_by_user_id` column; `revision` integer
  for bumping on claim transitions.
- Spec 03: `useIsAdmin(organizationId)` hook for Desktop admin
  gating; `AdminOnlyPlaceholder`; Access vocabulary (`private`,
  `shared_unclaimed`, `claimed`, `admin_managed`, `archived`).

Soft:

- Spec 06 (automations) and spec 07 (Slack): both set
  `visibility='shared_unclaimed'` and `origin='automation'` /
  `origin='slack'` on the exposure they create. Spec 05 doesn't
  change their flows but documents the claim eligibility.
- Spec 08 (web/mobile/dispatch): consumes the claim verbs.
- Spec 09 (billing): claim does not change billing identity;
  billing_subject stays org-scoped.

## 4. Current Repo State

Verified against `/home/user/proliferate` on 2026-05-20.

### 4.1 What is shipped

**Automation run executor leasing** — unrelated concept, but worth
noting so the spec doesn't accidentally collide with it:

```text
server/proliferate/db/store/automation_run_claims.py
  AutomationRun.executor_kind, executor_id, claim_id,
  claimed_at, claim_expires_at, last_heartbeat_at
  -- this is "executor (worker/desktop) leases an automation run"
  -- not user-facing workspace claiming
```

**`automation_cloud_workspace_claims.py`** creates cloud workspace
records linked to claimed automation runs. It does not implement
user-claim persistence.

**Cloud workspace ownership** today
(`db/models/cloud/workspaces.py`):

```text
owner_scope         personal | organization
owner_user_id       nullable
organization_id     nullable
created_by_user_id  always set
-- no visibility, no claim_state, no claimed_by_user_id
```

Org-owned workspaces are visible to all org members via
`server/proliferate/server/cloud/workspaces/access.py`
`cloud_workspace_user_can_read()` which checks
`owner_scope='organization'` and active org membership.

**No JWT or JWKS infrastructure exists**:

```text
server/proliferate/config.py
  jwt_secret              declared but UNUSED for JWT generation
  cloud_secret_key        HMAC-SHA256 signing key for runtime grants
                          (agent gateway) and runtime tokens

no jose/PyJWT/rsa in dependencies for signing
no /.well-known/jwks.json route
no JWT verification anywhere
```

**AnyHarness HTTP auth**
(`anyharness/crates/anyharness-lib/src/api/router.rs:463`):

```text
require_bearer_auth middleware
  expects single static bearer token (AppState.bearer_token)
  constant-time compare
  also accepts ?access_token= query param
no JWT validation; no per-route scope check
no user-context auth path; only worker-token-style static bearer
```

**Workspace access tokens** today are plaintext bearer tokens
issued by AnyHarness during sandbox provisioning, persisted
encrypted as `cloud_workspace.runtime_token_ciphertext`, and
returned via `WorkspaceConnection.access_token` to Desktop. Spec 00
drops these columns and routes runtime access via
`cloud_target_runtime_access`.

**Desktop remote-target access**
(`desktop/src/lib/access/anyharness/runtime-target.ts`):

```text
runtime location 'local'   localhost
runtime location 'cloud'   getCloudWorkspaceConnection() -> bearer
runtime location 'target'  SSH tunnel; no token
```

The "cloud" path uses a plaintext bearer with full sandbox scope.
There is no scoped per-workspace direct attach today.

### 4.2 Gaps spec 05 closes

- No `cloud_workspace_claim` user-claim table.
- No claim transitions wired into `cloud_workspace_exposure`.
- No `can_claim_cloud_workspace`, `can_request_direct_attach_token`
  access helpers.
- No admin manage view filter.
- No JWT infrastructure: no signing key, no JWKS endpoint, no
  AnyHarness validation, no jti revocation.
- No "claim/release/revoke" API endpoints.
- No Desktop direct-attach client code that uses a scoped JWT.

## 5. Target Model

### 5.1 `cloud_workspace_claim` (new)

Append-only claim history; one row per claim event. Latest active
row is the current claim.

```text
cloud_workspace_claim
  id                              uuid pk
  organization_id                 uuid fk organization.id            not null
  target_id                       uuid fk cloud_targets.id           not null
  exposure_id                     uuid fk cloud_workspace_exposure.id not null
  cloud_workspace_id              uuid fk cloud_workspace.id         not null
  anyharness_workspace_id         text                               nullable
  cloud_session_id                uuid fk cloud_session.id           nullable
  anyharness_session_id           text                               nullable

  claimed_by_user_id              uuid fk user.id                    not null
  source_kind                     text
                                  'slack' | 'automation' | 'api' | 'manual'
  status                          text
                                  'active' | 'released' | 'revoked' | 'superseded'

  claimed_at                      timestamptz                        not null
  released_at                     timestamptz                        nullable
  released_by_user_id             uuid fk user.id                    nullable
  revoked_at                      timestamptz                        nullable
  revoked_by_user_id              uuid fk user.id                    nullable
  revoke_reason                   text                               nullable

  created_at                      timestamptz                        not null

  CHECK ck_cloud_workspace_claim_status
  CHECK ck_cloud_workspace_claim_source_kind
  CHECK ck_cloud_workspace_claim_terminal
    (status='released'  -> released_at IS NOT NULL)
    (status='revoked'   -> revoked_at IS NOT NULL)

  UNIQUE PARTIAL ux_cloud_workspace_claim_active
    (cloud_workspace_id) WHERE status = 'active'
```

Rules:

- At most one `active` row per `cloud_workspace_id`.
- A new claim event for an already-claimed workspace fails with
  `claim_already_held`. Admin override goes through revoke + claim,
  not concurrent active rows.
- `released_at` and `revoked_at` are mutually exclusive with each
  other and with the active state.
- `source_kind` is the origin that created the unclaimed work
  (Slack, automation, manual). It survives the claim — claim does
  not change provenance.

`cloud_workspace_claim` rows are queryable for audit: "who claimed
this workspace, when, who released/revoked". They are not deleted
on workspace archival; they are retained for the workspace's
retention window.

### 5.2 Claim transitions and exposure interaction

State on `cloud_workspace_exposure` (from spec 04):

```text
visibility           private | shared_unclaimed | claimed |
                     admin_managed | archived
claimed_by_user_id   nullable
revision             integer; bumped on every transition
```

Transitions:

```text
shared_unclaimed -> claimed
  insert cloud_workspace_claim (status='active')
  set exposure.visibility='claimed'
  set exposure.claimed_by_user_id=<user>
  bump exposure.revision
  emit AgentAuthAuditEvent-style audit row? no — spec 05 uses the
    cloud_workspace_claim row itself as the audit record.

claimed -> shared_unclaimed   (release by claimer)
  update cloud_workspace_claim (status='released', released_at=now,
                                released_by_user_id=<claimer>)
  set exposure.visibility='shared_unclaimed'
  set exposure.claimed_by_user_id=NULL
  bump exposure.revision
  revoke active cloud_workspace_claim_token rows
  invalidate direct-attach JWTs (jti revoke cache push; see 5.5)

claimed -> shared_unclaimed   (revoke by admin)
  update cloud_workspace_claim (status='revoked', revoked_at=now,
                                revoked_by_user_id=<admin>,
                                revoke_reason=<text>)
  set exposure.visibility='shared_unclaimed'   (or 'admin_managed'
                                                if admin chooses to
                                                hold)
  set exposure.claimed_by_user_id=NULL
  bump exposure.revision
  revoke tokens as above

claimed -> archived           (claimer or admin archives)
  update cloud_workspace_claim (status='released' or 'revoked')
  set exposure.visibility='archived'
  set exposure.status='archived'
  revoke tokens

shared_unclaimed -> admin_managed   (admin hold pre-archive)
  set exposure.visibility='admin_managed'
  no claim row needed; admin_managed is a workspace-level state,
    not a user claim
  bump exposure.revision

admin_managed -> shared_unclaimed   (admin releases hold)
  set exposure.visibility='shared_unclaimed'
  bump exposure.revision

admin_managed -> archived           (admin archives)
  set exposure.visibility='archived' + exposure.status='archived'
```

The transitions are wrapped in a transaction. Spec 04's worker
exposure-gated tailer reads `revision` and reconciles on change.

**Effect on already-queued commands**:

A command enqueued while the workspace was `shared_unclaimed`
remains valid after the workspace transitions to `claimed` (the
authorization context at enqueue time was correct). The lease
proceeds.

Future commands from non-claimer users (post-claim) are rejected at
enqueue with `claim_held_by_other`. Admin manage operations are
allowed by `can_interact_cloud_workspace` with the admin override.

Active direct-attach tokens are revoked on every transition that
changes the claimed_by_user_id (see 5.5).

### 5.3 `cloud_workspace_claim_token` (new)

Durable token row for audit and revocation. The raw JWT is never
stored.

```text
cloud_workspace_claim_token
  id                              uuid pk
  claim_id                        uuid fk cloud_workspace_claim.id   not null
  token_jti                       text                               not null
  token_jti_hash                  text                               not null
  hash_key_id                     text                               not null

  issued_to_user_id               uuid fk user.id                    not null
  target_id                       uuid fk cloud_targets.id           not null
  anyharness_workspace_id         text                               not null
  anyharness_session_id           text                               nullable

  permissions                     text   -- comma-separated
                                  'read' | 'write' | 'control'
                                  (multi-permission: 'read,write,control')

  status                          text
                                  'active' | 'expired' | 'revoked'
  issued_at                       timestamptz                        not null
  expires_at                      timestamptz                        not null
  last_used_at                    timestamptz                        nullable
  revoked_at                      timestamptz                        nullable
  revoked_reason                  text                               nullable

  UNIQUE (token_jti_hash)
  CHECK ck_cloud_workspace_claim_token_status
  CHECK ck_cloud_workspace_claim_token_permissions
```

Notes:

- Cloud stores only `token_jti` (the unique JTI claim) and
  `token_jti_hash` (HMAC for lookup safety). The raw JWT body is
  never stored.
- Token rows accumulate; expired rows are pruned on a periodic
  reconciler.
- Multiple active tokens per claim are allowed (Desktop may refresh
  the token while still using the old one). Practical cap: 5
  active per claim at a time; oldest is revoked on overflow.

### 5.4 Cloud signing key + JWKS

Spec 05 introduces RS256 JWT signing for direct-attach tokens.
HMAC-SHA256 (existing `cloud_secret_key`) is not suitable for
verification by AnyHarness because the signing secret would have
to live in the sandbox.

```text
config additions (server/proliferate/config.py):
  cloud_jwt_signing_key_pem         RSA private key (PEM)
  cloud_jwt_signing_key_id          string identifying the active key
                                    (e.g. "k-2026-05")
  cloud_jwt_signing_key_previous_pem   optional; for grace overlap
                                       during rotation
  cloud_jwt_signing_key_previous_id    optional
  cloud_jwt_issuer                  "https://api.proliferate.ai"
  cloud_jwt_audience_anyharness     "anyharness"
  cloud_jwt_direct_attach_ttl_seconds  default 1200 (20 minutes)
```

JWKS endpoint:

```text
GET /v1/cloud/.well-known/jwks.json
  -> { keys: [ JWK_active, JWK_previous? ] }
  public, no auth
  cache-friendly headers
```

AnyHarness fetches JWKS once at startup and refreshes:

```text
on startup
on signature verification failure with kid not in cache
periodic refresh every 6 hours
```

Worker auth path is unchanged (static bearer token via
`bearer_token` middleware). JWT validation is an additional path,
not a replacement.

### 5.5 AnyHarness JWT verification + scope check

AnyHarness gains a new auth path. The existing single-bearer-token
behaviour stays for worker traffic; the JWT path is for user-claim
tokens.

```text
anyharness/crates/anyharness-lib/src/api/auth.rs           (new file)

pub enum AuthContext {
    Worker { token_id: String },             -- static bearer
    UserClaim {
        user_id: String,
        organization_id: String,
        cloud_workspace_id: String,
        anyharness_workspace_id: String,
        cloud_session_id: Option<String>,
        anyharness_session_id: Option<String>,
        claim_id: String,
        permissions: Permissions,
        jti: String,
        expires_at: i64,
    },
}

fn classify_token(token_str: &str) -> TokenKind {
    if looks_like_jwt(token_str) { TokenKind::Jwt }
    else { TokenKind::StaticBearer }
}
```

JWT validation rules (in order):

```text
1. parse 3-part JWT
2. fetch JWKS (or use cached); resolve kid -> public key
3. verify RS256 signature
4. validate iss = cloud_jwt_issuer (configured)
5. validate aud = "anyharness"
6. validate target_id claim == AppState.target_id
7. validate exp >= now (+ small clock skew tolerance)
8. lookup jti in revoked-jti cache:
     if present -> reject 401 token_revoked
9. extract permissions; build AuthContext::UserClaim
```

Per-route auth requirement:

```text
GET  /v1/workspaces                      Worker OR (UserClaim+read)
GET  /v1/workspaces/{id}                 Worker OR (UserClaim and id
                                                    matches token scope)
GET  /v1/workspaces/{id}/sessions        Worker OR scoped UserClaim
GET  /v1/sessions/{id}                   Worker OR scoped UserClaim
GET  /v1/sessions/{id}/events            Worker OR scoped UserClaim+read
POST /v1/sessions/{id}/prompt            Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/resolve-interaction Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/cancel-turn       Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/close             Worker OR scoped UserClaim+control

PUT  /v1/runtime-config                  Worker only       (spec 01)
PUT  /v1/agents/auth-config              Worker only       (spec 02)
*    /v1/cloud/worker/**                 Worker only

POST /v1/workspaces/{id}/mobility/*      Worker only       (spec 10)
```

The scope check: when AuthContext is UserClaim, the requested
workspace_id MUST equal `auth.anyharness_workspace_id`, and when a
session is in the path, the session id MUST equal
`auth.anyharness_session_id` (or `auth.anyharness_session_id` is
unset, meaning workspace-wide scope — V1 we always set
session_id when we have one).

**Revoked-jti cache**:

```text
in-memory store inside AnyHarness:
  HashMap<String, RevocationEntry { revoked_at, expires_at }>
  expires_at = original token exp + small grace
  entries pruned when expires_at < now

push path:
  POST /v1/cloud/worker/revoked-jtis      (worker-token-only)
    body: { jtis: [string] }
  worker forwards from Cloud reconciliation

pull path:
  worker periodically (every 60s) GETs
    /v1/cloud/worker/revoked-jtis?since=<timestamp>
  Cloud returns recent revocations for this target
  worker pushes into AnyHarness via PUT route

Most revocations are detected by natural expiry (20m TTL).
The push/pull path is for cases where immediate cutoff matters
(release/revoke action).
```

### 5.6 Direct-attach token issuance API

```text
POST /v1/cloud/workspaces/{cloud_workspace_id}/claim
  body: { source_kind? }                   defaults to 'manual'
  preconditions:
    can_claim_cloud_workspace(user, workspace)
    exposure.visibility == 'shared_unclaimed'
    no active claim
  response: ClaimResponse {
    claim_id,
    cloud_workspace_id,
    exposure_revision (new value),
    claimed_at,
  }

DELETE /v1/cloud/workspaces/{cloud_workspace_id}/claim
  preconditions:
    can_release_cloud_workspace(user, workspace)
       = (user is the claimer) OR (user is admin and revoke flow)
  body: { reason? }   -- for revoke
  response: ReleaseResponse { released_at | revoked_at }
  side effects: tokens revoked (see 5.5)

POST /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token
  client requirements:
    X-Client-Kind: desktop                 (header required in V1)
    user has an active claim on the workspace
  preconditions:
    can_request_direct_attach_token(user, workspace)
  body: {
    target_anyharness_workspace_id   echoed back for sanity
    session_id?                       optional narrow-to-session
    permissions: ['read'|'write'|'control']
  }
  response: {
    token: <RAW_JWT>,                      Desktop stores in OS keychain
    jti,
    expires_at,
    anyharness_base_url                     from cloud_target_runtime_access
    target_id,
    cloud_workspace_id,
    anyharness_workspace_id,
    cloud_session_id?,
    anyharness_session_id?,
    permissions
  }
```

The `X-Client-Kind: desktop` header gate is V1 best-effort; a
non-Desktop caller could spoof it. The deeper protection is that
web/mobile clients have no AnyHarness HTTP client and no way to
reach a managed cloud sandbox's HTTP. AnyHarness URLs are not
exposed to web/mobile. Hardening the gate is a future step (e.g.
client OAuth scope).

JWT claims:

```text
iss   = cloud_jwt_issuer                   "https://api.proliferate.ai"
aud   = "anyharness"
sub   = user_id                            uuid
exp   = now + cloud_jwt_direct_attach_ttl_seconds
nbf   = now
iat   = now
jti   = uuid4

org_id                  organization_id (string)
target_id               cloud_target.id (string)
cloud_workspace_id      cloud_workspace.id
anyharness_workspace_id cloud_workspace.anyharness_workspace_id
cloud_session_id        optional
anyharness_session_id   optional
claim_id                cloud_workspace_claim.id
permissions             ['read','write','control'] subset
```

Token refresh:

```text
POST /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token
  -- same endpoint; new token row created; old token row remains
     active until natural expiry, capped at 5 active tokens per
     claim.
```

Token revocation:

```text
DELETE /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-tokens/{token_id}
  -- explicit revoke (e.g. lost Desktop)
  -- requires can_release_cloud_workspace or admin
  -- jti added to push cache; AnyHarness gets it via worker pull
```

### 5.7 Cloud-mediated access policy

New / consolidated access helpers in
`server/proliferate/server/cloud/workspaces/access.py`:

```text
can_view_cloud_workspace(user, workspace, exposure?) -> bool
  - personal: user == owner_user_id
  - private  (exposure.visibility='private'): same
  - shared_unclaimed: user in workspace.organization_id members
  - claimed:
      user == exposure.claimed_by_user_id OR is_admin(org)
  - admin_managed: is_admin(org) only
  - archived: org admin only (and retention policy)

can_interact_cloud_workspace(user, workspace, exposure) -> bool
  - same shape but stricter; admins do not get write on claimed work
    unless they go through admin override (claim revoke first)
  - shared_unclaimed: any org member
  - claimed: only claimed_by_user_id (admin needs to revoke to act)
  - admin_managed: admin can interact (audit/manage); regular members no
  - archived: nobody

can_claim_cloud_workspace(user, workspace, exposure) -> bool
  - exposure.visibility == 'shared_unclaimed'
  - user in workspace.organization_id members
  - no active claim
  - workspace not archived

can_release_cloud_workspace(user, workspace, claim) -> bool
  - claim.status == 'active' AND
  - (user == claim.claimed_by_user_id    -- self release
     OR is_admin(workspace.organization_id))  -- admin revoke

can_request_direct_attach_token(user, workspace, claim) -> bool
  - claim is active and held by this user
  - workspace.target.kind == 'managed_cloud'
  - cloud_target_runtime_access exists for the target
  - client_kind == 'desktop'  (from request header)
  - billing_subject not blocked (spec 09 hook)
```

These helpers replace inline checks. Every workspace, command,
session, and transcript endpoint calls one of them.

### 5.8 Workspace listing rules

```text
GET /v1/cloud/workspaces?scope=my
  -- personal work owned by the current user
  -- PLUS claimed shared work where exposure.claimed_by_user_id = user

GET /v1/cloud/workspaces?scope=unclaimed&organization_id=<id>
  -- org-owned exposure.visibility='shared_unclaimed'
  -- requires org membership
  -- ordered by created_at desc

GET /v1/cloud/workspaces?scope=org-all&organization_id=<id>
  -- admin only (useIsAdmin gate per spec 03)
  -- returns ALL org workspaces including claimed_by_other,
     admin_managed, archived
  -- used by admin manage view

GET /v1/cloud/workspaces?scope=claimable&organization_id=<id>
  -- syntactic sugar for scope=unclaimed
  -- intended for Mobile/Web "team work" tabs
```

All list endpoints accept pagination + filters. Filters supported in
V1:

```text
origin       in ('manual_desktop','manual_web','manual_mobile',
                  'automation','slack','cowork_api')
visibility   in ('private','shared_unclaimed','claimed',
                  'admin_managed','archived')
sandbox_type in ('local','ssh','managed_personal','managed_shared')
since        timestamp
until        timestamp
```

Vocabulary strings come from spec 03 §5.3.

### 5.9 Release / revoke / unclaim flow

User-driven release:

```text
DELETE /v1/cloud/workspaces/{id}/claim
  -- claimer releases
  -- claim.status -> 'released'
  -- exposure.visibility -> 'shared_unclaimed'
  -- active direct-attach tokens revoked; jti pushed to AnyHarness
  -- the workspace returns to the unclaimed pool; any org member
     can claim again
```

Admin revoke:

```text
DELETE /v1/cloud/workspaces/{id}/claim
  body: { reason: text }
  -- admin (useIsAdmin) revokes another user's claim
  -- claim.status -> 'revoked' with revoked_by_user_id, revoke_reason
  -- exposure.visibility -> 'shared_unclaimed' OR 'admin_managed' if
     the admin wants to hold (query param ?hold=true)
  -- tokens revoked

Audit:
  cloud_workspace_claim row is the audit record. revoke_reason is
  required for admin revoke.
```

Admin archive:

```text
POST /v1/cloud/workspaces/{id}/archive
  -- admin archives the workspace (admin_managed -> archived)
  -- exposure.visibility = 'archived'
  -- claim row updated to revoked if still active
  -- worker stops projecting (exposure.status = 'archived')
```

### 5.10 Audit events

Claim transitions are auditable via the `cloud_workspace_claim`
rows themselves:

```text
who claimed     claimed_by_user_id, claimed_at
who released    released_by_user_id, released_at
who revoked     revoked_by_user_id, revoked_at, revoke_reason
source provenance survives via source_kind (slack | automation | api | manual)
```

For admin manage actions:

```text
cloud_workspace_admin_event             (new — optional in V1)
  workspace_id, organization_id,
  actor_user_id (admin), action
    ('admin_hold','admin_release','admin_archive','revoke_claim'),
  metadata_json, created_at
```

If V1 wants to keep the audit footprint small, defer
`cloud_workspace_admin_event` and rely on `cloud_workspace_claim`
rows + structured logs. Bias: defer the separate audit table to a
follow-up; the `cloud_workspace_claim` row + structured logs are
sufficient for V1.

### 5.11 Implementation notes for AnyHarness

Token classification:

```text
fn classify_token(token: &str) -> TokenKind {
    if token.split('.').count() == 3 {
        TokenKind::Jwt
    } else {
        TokenKind::StaticBearer
    }
}
```

Static bearer remains constant-time compared with the configured
worker token. JWT goes through verification.

Permissions enforcement:

```text
fn route_requires(perm: Permission) -> impl Fn(&AuthContext) -> Result<()> {
    move |ctx| match ctx {
        AuthContext::Worker { .. } => Ok(()),
        AuthContext::UserClaim { permissions, .. } => {
            permissions.contains(perm).then_some(()).ok_or(unauthorized)
        }
    }
}
```

Scope check (workspace/session match) is a separate middleware
layer applied to per-workspace routes:

```text
fn route_scoped_to_workspace(req, ctx) -> Result<()> {
    let path_workspace_id = extract_from_path(req);
    match ctx {
        AuthContext::Worker { .. } => Ok(()),
        AuthContext::UserClaim { anyharness_workspace_id, .. } => {
            if path_workspace_id != anyharness_workspace_id {
                return Err(forbidden_scope);
            }
            Ok(())
        }
    }
}
```

Implementation files:

```text
anyharness/crates/anyharness-lib/src/api/auth.rs               (new)
anyharness/crates/anyharness-lib/src/api/jwks.rs               (new)
anyharness/crates/anyharness-lib/src/api/middleware/
  worker_or_user.rs           (new) classify + verify + AuthContext
  require_permission.rs       (new) permission gate
  scope_workspace.rs          (new) workspace scope gate
  scope_session.rs            (new) session scope gate
anyharness/crates/anyharness-lib/src/api/router.rs
  rewire routes to use the new middleware stack instead of the
  single require_bearer_auth
anyharness/crates/anyharness-lib/src/api/revoked_jti.rs        (new)
  in-memory revocation cache + worker-token-only POST endpoint
```

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/claims.py                   (new)
  CloudWorkspaceClaim
  CloudWorkspaceClaimToken

server/proliferate/db/migrations/versions/<NEW>_claiming.py
  - cloud_workspace_claim
  - cloud_workspace_claim_token
  - cloud_workspace_exposure visibility CHECK update to include
    'admin_managed' (if spec 04 hasn't already)

server/proliferate/db/store/cloud_claims/                      (new)
  claims.py             insert/list/get_active/transition
  tokens.py             insert/list/revoke/expire/prune

server/proliferate/server/cloud/claims/                        (new)
  api.py                claim/release/direct-attach endpoints
  service.py            transition logic + JWT issuance
  models.py             pydantic request/response
  access.py             can_claim, can_release, can_request_direct_attach
  domain/policy.py      pure transition validity rules
  domain/jwt.py         pure JWT claim builders

server/proliferate/server/cloud/workspaces/access.py
  - rewrite can_view_cloud_workspace, can_interact_cloud_workspace
    to consume cloud_workspace_exposure + cloud_workspace_claim
  - admin override hooks

server/proliferate/server/cloud/workspaces/api.py
  - GET /workspaces?scope=my|unclaimed|org-all|claimable filters
  - GET /workspaces/{id} returns visibility + claimed_by_user_id +
    claim_id if active

server/proliferate/server/cloud/commands/access.py
  - command enqueue checks can_interact_cloud_workspace

server/proliferate/server/cloud/well_known/                    (new)
  api.py
    GET /v1/cloud/.well-known/jwks.json

server/proliferate/server/cloud/worker/api.py
  - POST /worker/revoked-jtis          (push)
  - GET  /worker/revoked-jtis?since=   (pull)

server/proliferate/config.py
  - cloud_jwt_signing_key_pem
  - cloud_jwt_signing_key_id
  - cloud_jwt_signing_key_previous_pem / _id
  - cloud_jwt_issuer
  - cloud_jwt_audience_anyharness  default 'anyharness'
  - cloud_jwt_direct_attach_ttl_seconds  default 1200

server/proliferate/server/automations/worker/cloud_execution/**
  - team automation workspaces stamp source_kind for the claim flow
    when they create the exposure

dependencies:
  pyjwt or python-jose with RSA support
```

Worker / AnyHarness (Rust):

```text
anyharness/crates/anyharness-contract/src/v1/auth.rs           (new)
  AuthContext shape exposed for handler trait
  Permission enum
  ClaimError, ScopeError typed responses

anyharness/crates/anyharness-lib/src/api/auth.rs               (new)
anyharness/crates/anyharness-lib/src/api/jwks.rs               (new)
anyharness/crates/anyharness-lib/src/api/middleware/**         (new)
anyharness/crates/anyharness-lib/src/api/revoked_jti.rs        (new)
anyharness/crates/anyharness-lib/src/api/router.rs
anyharness/crates/anyharness-lib/src/api/state.rs
  + JwksClient and RevokedJtiCache on AppState
  + cloud_jwt_audience: "anyharness"
  + target_id (already set by spec 00)
anyharness/crates/proliferate-worker/src/cloud_client/revoked_jti.rs (new)
  worker poll + push to AnyHarness
anyharness/crates/proliferate-worker/src/sync/revoked_jti.rs
  reconciler tick: pull from Cloud, push to AnyHarness

new Rust deps:
  jsonwebtoken with RS256
```

SDK regeneration:

```text
cloud/sdk/src/client/claims.ts                                 (new)
cloud/sdk/src/client/direct-attach.ts                          (new)
cloud/sdk/src/types/generated.ts                               regen
anyharness/sdk/generated/openapi.json                          regen
```

Desktop:

```text
desktop/src/hooks/access/cloud/claims/                         (new)
  use-workspace-claim.ts
  use-claim-mutations.ts
  use-direct-attach-token.ts

desktop/src/lib/access/anyharness/runtime-target.ts
  - new runtime location 'shared_cloud' that uses
    cloud_target_runtime_access.anyharness_base_url +
    Bearer <direct-attach JWT>
  - lookup flow: claimed-by-me workspace -> fetch JWT -> connect

desktop/src/components/workspaces/*
  - "Claim" / "Release" buttons in workspace headers when
    visibility='shared_unclaimed' (claim) or 'claimed' by me (release)
  - "Open in Desktop (direct)" CTA appears only when:
      claim active AND
      workspace.sandbox_type in ('managed_personal','managed_shared')
  - Cloud-mediated CTAs (open in web/mobile) remain available

desktop/src/lib/storage/direct-attach-tokens.ts                (new)
  - store JWT in OS keychain (electron / tauri secure storage)
  - refresh on expiry
```

## 7. Implementation Chunks

```text
Chunk A  Cloud schema + service
  - cloud_workspace_claim + cloud_workspace_claim_token migrations
  - claims store
  - claims service (transitions + JWT issuance with PyJWT/jose)
  - claims/access.py helpers
  - claims api endpoints

Chunk B  JWKS endpoint + signing key config
  - config additions (cloud_jwt_*)
  - GET /v1/cloud/.well-known/jwks.json
  - test JWKS rotation with two keys

Chunk C  AnyHarness JWT verification
  - anyharness-lib/api/auth.rs classify+verify
  - middleware stack: worker_or_user, require_permission,
    scope_workspace, scope_session
  - rewire router to apply per-route
  - in-memory revoked-jti cache
  - PUT /v1/cloud/worker/revoked-jtis endpoint

Chunk D  Worker revoked-jti reconciliation
  - worker pulls from Cloud (every 60s)
  - pushes to AnyHarness on change
  - Cloud-side endpoint GET/POST /worker/revoked-jtis

Chunk E  Workspace listing + access policy refactor
  - scope filters my | unclaimed | claimable | org-all
  - access helpers (can_view / can_interact / can_claim /
    can_release / can_request_direct_attach_token)
  - cmd enqueue uses can_interact

Chunk F  Desktop direct-attach
  - claim/release mutations
  - direct-attach-token mutation
  - new runtime location 'shared_cloud'
  - JWT storage in OS keychain
  - UI: claim CTA, release CTA, "Open in Desktop (direct)" CTA

Chunk G  Admin manage view
  - admin scope=org-all listing
  - admin revoke with reason
  - admin_managed hold/release
  - admin archive

Chunk H  Tests + smoke
```

## 8. Acceptance Criteria

1. `cloud_workspace_claim` exists with append-only history. At most
   one `active` row per workspace, enforced by partial unique index.
2. Claim transitions update `cloud_workspace_exposure.visibility`
   and `claimed_by_user_id` in the same transaction as the claim
   row, and bump `exposure.revision`.
3. `cloud_workspace_claim_token` stores only `token_jti` and
   `token_jti_hash`; raw JWT bodies are never persisted.
4. RS256 signing key configured via `cloud_jwt_signing_key_pem` +
   `cloud_jwt_signing_key_id`. Optional previous key for rotation
   overlap.
5. `GET /v1/cloud/.well-known/jwks.json` returns the active key (and
   previous key when configured) as JWKs. Public, cacheable.
6. AnyHarness `api/auth.rs` classifies tokens into Worker /
   UserClaim and applies separate verification. The single-bearer
   worker auth path is unchanged for worker traffic.
7. AnyHarness rejects JWTs whose `aud != 'anyharness'`,
   `iss != configured`, `target_id != AppState.target_id`, or
   `exp < now`. Returns 401 with typed `error_code`.
8. Per-route middleware enforces permission (read/write/control)
   and workspace/session scope. Worker tokens bypass the scope
   check (target-wide auth).
9. Revoked-jti cache exists in AnyHarness. Worker push endpoint
   `PUT /v1/cloud/worker/revoked-jtis` and worker reconciliation
   pull from `GET /v1/cloud/worker/revoked-jtis?since=` both work.
10. `POST /v1/cloud/workspaces/{id}/claim` creates an active claim
    when preconditions hold; returns 409 `claim_already_held`
    otherwise.
11. `DELETE /v1/cloud/workspaces/{id}/claim` releases (self) or
    revokes (admin with reason); old tokens are revoked; visibility
    flips back to `shared_unclaimed` (or `admin_managed` with
    `?hold=true`).
12. `POST /v1/cloud/workspaces/{id}/direct-access-token` requires
    `X-Client-Kind: desktop`, an active claim by the calling user,
    and a managed-cloud target. Returns RAW JWT + JTI + expires_at
    + `anyharness_base_url` from `cloud_target_runtime_access`.
13. Web and mobile callers never receive a JWT. `X-Client-Kind`
    other than `desktop` gets 403 `direct_attach_desktop_only`.
14. `can_view_cloud_workspace`, `can_interact_cloud_workspace`,
    `can_claim_cloud_workspace`, `can_release_cloud_workspace`,
    `can_request_direct_attach_token` exist and are called by every
    workspace/command/session endpoint.
15. Already-queued commands enqueued before a claim continue to
    lease successfully. Future commands from non-claimers are
    rejected at enqueue with `claim_held_by_other`.
16. Workspace listing supports `scope=my | unclaimed | org-all |
    claimable` with the documented semantics. `org-all` requires
    org admin.
17. Admin revoke requires a `reason` string; `cloud_workspace_claim`
    row records `revoked_by_user_id` + `revoke_reason`.
18. `admin_managed` is reachable only by admin action and renders
    the workspace inert for non-admins (no view, no interact, no
    claim).
19. Desktop new runtime location `shared_cloud` connects to
    `cloud_target_runtime_access.anyharness_base_url` with `Authorization:
    Bearer <direct-attach JWT>`. AnyHarness accepts and scopes
    reads/writes to the JWT's workspace + session.
20. Desktop refreshes the direct-attach token before expiry; old
    token rows are revoked on natural expiry by the prune
    reconciler.
21. JWKS rotation works: signing-key change with both old and new
    in JWKS results in zero downtime; old tokens verify until
    natural expiry, new tokens verify with the new key.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests:

```text
tests/server/cloud/claims/test_claim_inserts_active_row.py
tests/server/cloud/claims/test_one_active_claim_per_workspace.py
tests/server/cloud/claims/test_release_transitions_to_shared_unclaimed.py
tests/server/cloud/claims/test_admin_revoke_requires_reason.py
tests/server/cloud/claims/test_admin_revoke_hold_to_admin_managed.py
tests/server/cloud/claims/test_admin_archive.py
tests/server/cloud/claims/test_claim_token_jti_unique.py
tests/server/cloud/claims/test_token_refresh_caps_at_five.py
tests/server/cloud/claims/test_jwt_claims_shape.py
tests/server/cloud/claims/test_jwks_returns_active_and_previous.py
tests/server/cloud/claims/test_jwks_rotation_no_downtime.py
tests/server/cloud/access/test_can_view_claim_states.py
tests/server/cloud/access/test_can_interact_admin_override.py
tests/server/cloud/access/test_can_claim_excludes_non_org_member.py
tests/server/cloud/commands/test_command_rejected_post_claim_non_claimer.py
tests/server/cloud/commands/test_queued_command_preclaim_proceeds.py
tests/server/cloud/workspaces/test_list_scope_my.py
tests/server/cloud/workspaces/test_list_scope_unclaimed.py
tests/server/cloud/workspaces/test_list_scope_org_all_admin_only.py
tests/server/cloud/worker/test_revoked_jti_push_and_pull.py
tests/server/cloud/claims/test_direct_attach_desktop_only_header.py
tests/server/cloud/claims/test_direct_attach_token_returns_runtime_access.py
```

AnyHarness:

```bash
cargo test -p anyharness-contract
cargo test -p anyharness-lib api::auth
cargo test -p anyharness-lib api::middleware
cargo test -p anyharness-lib api::jwks
cargo test -p anyharness-lib api::revoked_jti
```

Targeted Rust tests:

```text
anyharness/crates/anyharness-lib/src/api/auth.rs#tests
  - classify_token splits jwt vs static bearer
  - worker bearer constant-time compare unchanged
  - JWT happy path -> AuthContext::UserClaim
  - aud mismatch -> 401
  - target_id mismatch -> 401
  - exp expired -> 401
  - jti revoked -> 401
  - kid not in JWKS -> refresh JWKS -> retry; permanent miss -> 401

anyharness/crates/anyharness-lib/src/api/middleware/scope_workspace.rs#tests
  - worker passes scope check
  - user_claim wrong workspace_id -> 403

anyharness/crates/anyharness-lib/src/api/middleware/scope_session.rs#tests
  - user_claim with session-scoped JWT denied on other session
  - user_claim with workspace-scoped JWT allowed on any session of
    that workspace

anyharness/crates/anyharness-lib/src/api/revoked_jti.rs#tests
  - push adds to cache
  - cache prunes after expiry
  - JWT with revoked jti rejected
```

Desktop:

```bash
cd desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
desktop/src/hooks/access/cloud/claims/use-workspace-claim.test.ts
desktop/src/hooks/access/cloud/claims/use-direct-attach-token.test.ts
desktop/src/lib/access/anyharness/runtime-target.test.ts
  - shared_cloud target uses cloud_target_runtime_access + JWT
desktop/src/lib/storage/direct-attach-tokens.test.ts
  - keychain put/get/delete round-trip
  - refresh before expiry
```

Manual smoke:

```text
1. Slack creates shared work; org member claims
   - visibility flips shared_unclaimed -> claimed
   - other org members lose interact via Cloud
   - admin still sees in scope=org-all
   - claimer's web/mobile session works through Cloud
   - claimer's Desktop calls direct-attach-token
   - Desktop opens shared_cloud target; AnyHarness validates JWT;
     prompt sent via Desktop direct path appears in transcript

2. Concurrent prompts from Desktop direct + Cloud
   - both prompts reach the same AnyHarness session loop
   - serialized; both appear in transcript
   - worker projects events for the Cloud path; Desktop sees them
     via direct-attach SSE (in addition to its own writes)

3. Release
   - claimer hits DELETE /claim
   - visibility flips back to shared_unclaimed
   - Desktop direct-attach token revoked
   - within revocation-cache propagation (60s pull, instant push)
     AnyHarness rejects the token with token_revoked
   - other org members can claim

4. Admin revoke
   - admin hits DELETE /claim with reason
   - claim.status = 'revoked'; revoke_reason saved
   - visibility -> shared_unclaimed (or admin_managed if ?hold=true)
   - tokens revoked
   - claim history still queryable

5. JWKS rotation
   - operator adds new signing key as active; previous key kept
   - JWKS returns both
   - tokens signed with new key verify
   - tokens signed with previous key (still in TTL) verify
   - after previous key removed from config + cache pruned, old
     tokens fail

6. Token refresh
   - Desktop calls direct-attach-token again before expiry
   - new token issued; old token row still active
   - 5-token cap: 6th request triggers oldest revoke

7. Web/mobile cannot get JWT
   - X-Client-Kind != 'desktop' -> 403 direct_attach_desktop_only
```

## 10. Open Questions

1. **Should `admin_managed` be a separate visibility state, or just
   an attribute (e.g. `admin_held: bool`)?**

   Bias: keep it as a visibility state. It's mutually exclusive with
   the others and the access policy differs (no member view, no
   member claim). An attribute would force every read to compose
   two columns.

2. **Token TTL: 20 minutes default, configurable. Right value?**

   Tradeoffs:
     short  better revocation latency, more refresh traffic
     long   fewer refresh, slower revocation cutoff (until natural
            expiry)

   Bias: 20 minutes. With the push-based jti revocation cache,
   immediate cutoff is supported anyway; long TTL doesn't help.

3. **JWT permissions: comma-separated string or array?**

   Storage: text comma-separated for simplicity in the DB.
   On the wire (JWT claim): array `["read","write","control"]`.
   Parsing happens in the access helper.

4. **What if the AnyHarness URL changes during a claim (slot
   replacement)?**

   The JWT carries `target_id`. AnyHarness validates `target_id ==
   AppState.target_id`. If the slot is replaced and a new AnyHarness
   process boots with a new state.target_id, old JWTs fail target
   check.

   But `target_id` is supposed to be stable across slot replacement
   (spec 00 invariant). Worker re-enrollment preserves target_id.
   So slot replacement should not invalidate JWTs.

   Open: what about slot replacement that changes target_id (rare,
   e.g. provisioning a new managed target)? Bias: yes, JWTs fail;
   Desktop refreshes; new JWT carries the new target_id. The
   refresh flow handles this transparently.

5. **Hardening `X-Client-Kind: desktop` gate**

   The header is spoofable. A user with a valid claim could
   request the JWT from a non-Desktop client. The downside is
   bounded: the JWT only works against the AnyHarness URL, which
   is not exposed to web/mobile UI (they have no AnyHarness HTTP
   client). Still, "spoofable" is a real concern.

   Hardening options:
     (a) Tie to Desktop OAuth client_id
     (b) Require a Desktop-only auth method (e.g. session token
         issued by the Desktop installer)
     (c) Accept the spoofability since the attack surface is small

   Bias: (c) for V1. Move to (a) when Desktop OAuth client
   identity exists. Track as a follow-up.

6. **`cloud_workspace_admin_event` audit table — V1 or follow-up?**

   Bias: follow-up. `cloud_workspace_claim` + structured logs are
   sufficient for V1. The separate audit table is useful when admin
   manage actions multiply beyond claim revoke (e.g. abuse manage,
   data export, retention overrides). Spec 05 defers.

7. **What happens to the workspace if the claimer's user account is
   deleted/disabled?**

   The active claim row references `claimed_by_user_id`. If the
   user is hard-deleted, the FK CASCADE/SET NULL behavior decides.

   Bias: ON DELETE SET NULL on `claimed_by_user_id`, with a
   reconciler that sweeps claims with NULL claimer + sets status
   to `'revoked'` with `revoke_reason='user_deleted'`. Exposure
   transitions to `shared_unclaimed` or `archived` based on policy
   (V1: `shared_unclaimed`).

8. **Claim survives session changes?**

   A workspace may have multiple sessions over time. The claim is
   on the workspace, not a session. So yes, claim survives.
   `cloud_workspace_claim.cloud_session_id` is just the session at
   claim time (for audit/UI); it does not narrow the claim to that
   session.
