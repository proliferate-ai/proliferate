# 05 — Claiming

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`04-cloud-running-alignment.md`](04-cloud-running-alignment.md).

Claiming is a one-way ownership transition. When work is created
shared and unclaimed (by Slack, automations, or another team path),
one org member can claim it. After that, only the claimer can act on
it via Cloud-mediated APIs, and Desktop can attach directly via a
scoped token. There is no release. There is no admin revoke. The
only way to make a claimed workspace inert is to archive the
workspace itself.

## 1. Purpose & Scope

In scope:

- `cloud_workspace_claim` table: one row per workspace; created at
  claim time; never updated.
- One-way claim transition: `shared_unclaimed → claimed`.
- Cloud-mediated access policy helpers used by every workspace/
  command/session endpoint.
- Workspace listing scopes: my work, the team unclaimed pool, and an
  admin audit listing for org admins.
- Direct-attach JWT issuance (Desktop only): short-lived RS256 JWT
  scoped to one claimed workspace/session, validated by AnyHarness.
- Per-token revocation (for lost Desktop, security incidents). The
  *claim* is not revocable; individual *tokens* are.
- Cloud signing key + target-delivered verification key; AnyHarness JWT
  verification + scope check on every per-workspace route.

Out of scope:

- Release / revoke / undo claim. **Claiming cannot be undone.** Once
  a user claims, the workspace belongs to that user for its
  lifetime. Mistakes are recovered by archiving the workspace and
  creating new work.
- Admin override of an active claim. Admins cannot reassign or
  unclaim. Admins can audit (read-only) and archive (workspace-
  level retention action).
- An `admin_managed` workspace state. Not needed in this model. The
  vocabulary in spec 03 §5.3 drops `admin_managed`.
- Web/mobile direct AnyHarness access. Cloud-mediated only.
- Slack inbound webhook (→ spec 07).
- Automation lifecycle (→ spec 06).
- Signing-key rotation operations (key generation, key store, rollout
  cadence). Spec 05 defines the token model and verification-key delivery;
  ops procedures are a deployment doc.
- Multi-claimer "team session" sharing. Single-user claim is the
  model.
- Cross-org workspace migration (different operation; out of
  roadmap).
- Replacing the existing `automation_run_claims` executor lease.
  Unrelated executor lifecycle; stays as-is.

## 2. Mental Model

```text
shared_unclaimed     org-owned work, visible to every org member,
                     interactable by every org member through
                     Cloud-mediated APIs.
                     No direct AnyHarness access for any user.

claim                Cloud records that one user claimed the work.
                     Atomic. Persisted in cloud_workspace_claim.
                     Irreversible.

claimed              exposure.visibility = 'claimed'.
                     exposure.claimed_by_user_id is set.
                     Cloud-mediated interaction restricted to the
                     claiming user. Admins have read-only audit
                     view. Desktop direct-attach allowed for the
                     claiming user via a scoped JWT.

archived             workspace-level retention action (separate
                     concern). The claim row remains for audit.
```

Two access surfaces, one set of policy:

```text
Cloud-mediated (web, mobile, Slack, automation, Desktop "cloud" path)
  -> /v1/cloud/* endpoints
  -> Cloud authority decides who can view/interact/claim
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

Token-level revocation (e.g. lost Desktop) is supported. *Claim*
revocation is not.

## 3. Dependencies

Hard:

- Spec 00: `cloud_target_runtime_access` (Desktop reads AnyHarness
  base URL from here); `sandbox_profile_target_state`.
- Spec 04: `cloud_workspace_exposure` exists with visibility enum
  including `shared_unclaimed` and `claimed`, and
  `claimed_by_user_id` column; `revision` integer for bumping on
  claim.
- Spec 03: `useIsAdmin(organizationId)` hook for Desktop admin
  audit-listing gate; `AdminOnlyPlaceholder`; Access vocabulary
  (`private`, `shared_unclaimed`, `claimed`, `archived` — note
  `admin_managed` is dropped from spec 03 by this spec).

Soft:

- Spec 06 (automations) and spec 07 (Slack): both set
  `visibility='shared_unclaimed'` on the exposure they create.
  Spec 05 doesn't change their flows but documents claim
  eligibility.
- Spec 08 (web/mobile/dispatch): consumes the claim verb.
- Spec 09 (billing): claim does not change billing identity;
  billing_subject stays org-scoped.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

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
`cloud_workspace_user_can_read()`.

**No direct-attach JWT infrastructure exists**:

```text
server/proliferate/config.py
  jwt_secret              declared but UNUSED for JWT generation
  cloud_secret_key        HMAC-SHA256 signing key for runtime grants
                          (agent gateway) and runtime tokens

python-jose[cryptography] and cryptography already exist in server deps
no claim-token verification key delivery to AnyHarness
no JWT verification anywhere
```

**AnyHarness HTTP auth**
(`anyharness/crates/anyharness-lib/src/api/router.rs:463`):

```text
require_bearer_auth middleware
  expects single static bearer token
  constant-time compare
no JWT validation; no per-route scope check
no user-context auth path
```

**Desktop remote-target access**
(`apps/desktop/src/lib/access/anyharness/runtime-target.ts`):

```text
runtime location 'local'   localhost
runtime location 'cloud'   getCloudWorkspaceConnection() -> bearer
runtime location 'target'  SSH tunnel; no token
```

There is no scoped per-workspace direct attach today.

### 4.2 Gaps spec 05 closes

- No `cloud_workspace_claim` user-claim table.
- No claim transition wired into `cloud_workspace_exposure`.
- No `can_claim_cloud_workspace`,
  `can_request_direct_attach_token` access helpers.
- No JWT infrastructure: no signing key, no AnyHarness verification-key
  configuration, no AnyHarness validation, no jti revocation.
- No claim API endpoint.
- No Desktop direct-attach client code that uses a scoped JWT.

## 5. Target Model

### 5.1 `cloud_workspace_claim` (new)

One row per workspace per lifetime. Insert-once, never updated.

```text
cloud_workspace_claim
  id                              uuid pk
  cloud_workspace_id              uuid fk cloud_workspace.id         not null unique
  exposure_id                     uuid fk cloud_workspace_exposure.id not null
  organization_id                 uuid fk organization.id            not null
  target_id                       uuid fk cloud_targets.id           not null
  anyharness_workspace_id         text                               nullable
  cloud_session_id                uuid fk cloud_session.id           nullable
  anyharness_session_id           text                               nullable

  claimed_by_user_id              uuid fk user.id ON DELETE SET NULL nullable
  source_kind                     text   -- audit; survives claim
                                  'slack' | 'automation' | 'api' | 'manual'

  claimed_at                      timestamptz                        not null
  created_at                      timestamptz                        not null

  CHECK ck_cloud_workspace_claim_source_kind
  UNIQUE (cloud_workspace_id)
```

Rules:

- Exactly one row per `cloud_workspace_id`. Insert succeeds once;
  any subsequent claim attempt fails with `claim_already_held`.
- `claimed_by_user_id` is nullable to survive user deletion (see
  §5.7); the workspace remains `claimed` even with a null claimer.
  Admin can archive an orphan-claim workspace.
- `source_kind` is the origin that created the unclaimed work. It
  is recorded at claim time for audit and never changes.
- `cloud_session_id` / `anyharness_session_id` capture the session
  at claim time, for UI deep links. They do not narrow the claim;
  the claim covers the workspace including future sessions.

### 5.2 Claim transition

Single transition. No others.

```text
shared_unclaimed -> claimed
  INSERT cloud_workspace_claim (unique by cloud_workspace_id)
  UPDATE cloud_workspace_exposure
    SET visibility = 'claimed',
        claimed_by_user_id = <user>,
        revision = revision + 1
  emit audit log entry (structured log; no separate audit table)

There is no claimed -> shared_unclaimed transition.
There is no claimed -> admin_managed transition.
There is no admin_managed state.

The only way to make a claimed workspace inert is to archive the
workspace (workspace-level operation; same path as archiving a
personal workspace). Archive does not modify the claim row.
```

Both writes happen in one transaction. Spec 04's worker
exposure-gated tailer reads `revision` and reconciles on change
(the revision bumps from claim aren't observable to the worker as
a meaningful change since the projection_level and commandable
flags stay the same; but the bump is correct for cache
invalidation).

**Effect on already-queued commands**:

A command enqueued while the workspace was `shared_unclaimed`
remains valid (the authorization context at enqueue time was
correct). The lease proceeds.

Future commands from non-claimer users (post-claim) are rejected
at enqueue with `claim_held_by_other`. Admins do not get an
interact override.

### 5.3 `cloud_workspace_claim_token` (new)

Durable token row for audit and per-token revocation. The raw JWT
is never stored.

```text
  cloud_workspace_claim_token
  id                              uuid pk
  claim_id                        uuid fk cloud_workspace_claim.id   not null
  token_jti_hash                  text                               not null
  hash_key_id                     text                               not null
  token_jti_prefix                text                               nullable

  issued_to_user_id               uuid fk user.id                    not null
  target_id                       uuid fk cloud_targets.id           not null
  anyharness_workspace_id         text                               not null
  anyharness_session_id           text                               nullable

  permissions                     text   -- comma-separated
                                  'read' | 'write' | 'control'

  status                          text   'active' | 'expired' | 'revoked'
  issued_at                       timestamptz                        not null
  expires_at                      timestamptz                        not null
  last_used_at                    timestamptz                        nullable
  revoked_at                      timestamptz                        nullable
  revoked_reason                  text                               nullable

  UNIQUE (token_jti_hash)
  CHECK ck_cloud_workspace_claim_token_status
```

Notes:

- Cloud stores only `token_jti_hash` plus an optional display/debug prefix.
  Raw JWT body and raw `jti` are never persisted.
- Multiple active tokens per claim are allowed (Desktop may refresh
  while still using the old one). Practical cap: 5 active per
  claim; oldest is revoked on overflow.
- Token revocation **does not** revoke the claim. Revoking a token
  just invalidates that specific JWT. The claimer can request a
  fresh token any time.
- Expired tokens are pruned on a periodic reconciler.

### 5.4 Cloud signing key + verification-key delivery

Spec 05 introduces RS256 JWT signing for direct-attach tokens.
HMAC-SHA256 (existing `cloud_secret_key`) is not suitable for
verification by AnyHarness because the signing secret would have
to live in the sandbox.

```text
config additions (server/proliferate/config.py):
  cloud_jwt_signing_key_pem         RSA private key (PEM)
  cloud_jwt_signing_key_id          string identifying the active key
                                    (e.g. "k-2026-05")
  cloud_jwt_verification_keys_json  public keys accepted by AnyHarness,
                                    including active and previous keys during
                                    overlap
  cloud_jwt_issuer                  "https://api.proliferate.ai"
  cloud_jwt_audience_anyharness     "anyharness"
  cloud_jwt_direct_attach_ttl_seconds  default 1200 (20 minutes)
```

Verification-key delivery:

```text
Cloud includes cloud_jwt_verification_keys_json in target bootstrap/runtime
configuration. The worker applies it to AnyHarness through the managed
runtime configuration path. AnyHarness stores the public keys locally and
uses kid to select a key when validating a claim token.
```

AnyHarness does not fetch JWKS or call Cloud. Key rotation is delivered by the
same worker-mediated config path as other target-scoped runtime settings.

Worker auth path is unchanged (static bearer token via
`bearer_token` middleware). JWT validation is an additional path.

### 5.5 AnyHarness JWT verification + scope check

AnyHarness gains a new auth path. Worker bearer behaviour stays
for worker traffic.

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
    if token_str.split('.').count() == 3 { TokenKind::Jwt }
    else { TokenKind::StaticBearer }
}
```

JWT validation rules (in order):

```text
1. parse 3-part JWT
2. resolve kid against configured local verification key set
3. verify RS256 signature
4. validate iss = cloud_jwt_issuer (configured)
5. validate aud = "anyharness"
6. validate target_id claim == configured runtime target id
7. validate exp >= now (+ small clock skew tolerance)
8. lookup jti in revoked-jti cache:
     if present -> reject 401 token_revoked
9. extract permissions; build AuthContext::UserClaim
```

Per-route auth requirement:

```text
GET  /v1/workspaces                      Worker OR (UserClaim+read)
GET  /v1/workspaces/{id}                 Worker OR scoped UserClaim
GET  /v1/workspaces/{id}/sessions        Worker OR scoped UserClaim
GET  /v1/sessions/{id}                   Worker OR scoped UserClaim
GET  /v1/sessions/{id}/events            Worker OR scoped UserClaim+read
POST /v1/sessions/{id}/prompt            Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/interactions/{request_id}/resolve Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/cancel-turn       Worker OR scoped UserClaim+write
POST /v1/sessions/{id}/close             Worker OR scoped UserClaim+control

PUT  /v1/runtime-config                  Worker only       (spec 01)
PUT  /v1/agents/auth-config              Worker only       (spec 02)
*    /v1/cloud/worker/**                 Worker only

POST /v1/workspaces/{id}/mobility/*      Worker only       (spec 10)
```

Scope check: when AuthContext is UserClaim, the requested
workspace_id MUST equal `auth.anyharness_workspace_id`. When a
session is in the path, the session id MUST equal
`auth.anyharness_session_id` (or the JWT was issued workspace-wide
with no session narrowing).

**Revoked-jti cache**:

```text
in-memory store inside AnyHarness:
  HashMap<String, RevocationEntry { revoked_at, expires_at }>
  expires_at = original token exp + small grace
  entries pruned when expires_at < now

local AnyHarness push path:
  PUT /v1/auth/revoked-jtis
    body: { jti_hashes: [string], expires_at }
    auth: existing target-wide runtime bearer token only

Cloud pull path:
  worker periodically (every 60s) GETs
    /v1/cloud/worker/revoked-jtis?since=<timestamp>
  Cloud returns recent revocations for this target
  worker pushes hashed entries into AnyHarness via PUT /v1/auth/revoked-jtis
```

Natural expiry (20m TTL) handles most cases. Push/pull is for
explicit per-token revocation.

### 5.6 Claim and direct-attach API

```text
POST /v1/cloud/workspaces/{cloud_workspace_id}/claim
  body: { source_kind? }                   defaults to 'manual'
  preconditions:
    can_claim_cloud_workspace(user, workspace)
    exposure.visibility == 'shared_unclaimed'
  response: ClaimResponse {
    claim_id,
    cloud_workspace_id,
    exposure_revision (new value),
    claimed_at,
    claimed_by_user_id
  }
  errors:
    claim_already_held       claim row exists for this workspace
    not_org_member           user is not in workspace.organization_id
    workspace_not_unclaimed  exposure.visibility != 'shared_unclaimed'

POST /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token
  client requirements:
    X-Client-Kind: desktop                 (header required in V1)
    user has the active claim on the workspace
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

POST /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token/refresh
  -- same shape; new token row created; old token row remains
     active until natural expiry, capped at 5 active per claim.

DELETE /v1/cloud/workspaces/{cloud_workspace_id}/direct-access-tokens/{token_id}
  -- explicit per-token revoke (e.g. lost Desktop, security
     incident). Requires the claimer (or admin for emergency).
  -- the claim itself is NOT affected
  -- jti added to push cache; AnyHarness gets it via worker pull
```

There is **no** `DELETE /v1/cloud/workspaces/{id}/claim` endpoint.

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

### 5.7 Cloud-mediated access policy

Access helpers in
`server/proliferate/server/cloud/workspaces/access.py`:

```text
can_view_cloud_workspace(user, workspace, exposure?) -> bool
  - personal: user == owner_user_id
  - private  (exposure.visibility='private'): same
  - shared_unclaimed: user in workspace.organization_id members
  - claimed:
      user == exposure.claimed_by_user_id OR is_admin(org)
        -- admin gets view (audit-only)
  - archived: org admin only (retention policy)

can_interact_cloud_workspace(user, workspace, exposure) -> bool
  - personal / private: owner only
  - shared_unclaimed: any org member
  - claimed: ONLY exposure.claimed_by_user_id
              -- admin does NOT get interact override
  - archived: nobody

can_claim_cloud_workspace(user, workspace, exposure) -> bool
  - exposure.visibility == 'shared_unclaimed'
  - user in workspace.organization_id members
  - no existing cloud_workspace_claim row for this workspace
  - workspace not archived

can_request_direct_attach_token(user, workspace, claim) -> bool
  - claim row exists for this workspace
  - claim.claimed_by_user_id == user.id
  - workspace.target.kind == 'managed_cloud'
  - cloud_target_runtime_access exists for the target
  - client_kind == 'desktop'  (from request header)
  - billing_subject not blocked (spec 09 hook)

can_revoke_claim_token(user, workspace, token) -> bool
  - user == claim.claimed_by_user_id OR is_admin(org)
  - token.status == 'active'
```

There is no `can_release_cloud_workspace` and no
`can_revoke_claim`. Those operations do not exist.

User deletion: if `claimed_by_user_id` is SET NULL by the cascade
(see §5.7's "user deletion" sub-rule below), `can_view_cloud_workspace`
returns false for everyone except admins; admins can audit-view
and archive.

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
  -- admin only (useIsAdmin gate per spec 03); audit-only
  -- returns ALL org workspaces including claimed_by_other and
     archived
  -- response includes visibility + claimed_by_user_id so the UI
     can show "claimed by Alice" badges
  -- admin can view + archive; cannot interact or unclaim

GET /v1/cloud/workspaces?scope=claimable&organization_id=<id>
  -- syntactic sugar for scope=unclaimed
```

Filters supported in V1:

```text
origin       in ('manual_desktop','manual_web','manual_mobile',
                  'automation','slack','cowork_api')
visibility   in ('private','shared_unclaimed','claimed','archived')
sandbox_type in ('local','ssh','managed_personal','managed_shared')
since        timestamp
until        timestamp
```

Vocabulary strings come from spec 03 §5.3 (the `admin_managed` value
is dropped by this spec).

### 5.9 User deletion

If a user account is deleted/disabled:

```text
ON DELETE SET NULL on cloud_workspace_claim.claimed_by_user_id
                     cloud_workspace_exposure.claimed_by_user_id

Reconciler sweep (spec 05 ships):
  for each cloud_workspace_claim where claimed_by_user_id IS NULL
       AND cloud_workspace_exposure.visibility = 'claimed':
    -- the workspace is now "orphan-claimed"
    -- DO NOT transition exposure.visibility (claim is irreversible)
    -- log an audit event "claimer deleted"
    -- admin can archive the workspace through the normal archive
       path

The reconciler does not return the workspace to shared_unclaimed.
The product invariant ("claim is irreversible") wins over "the
workspace is now usable again." Admins archive orphaned workspaces.
```

This is a deliberate product choice: ensure that claim history is
durable and never silently undone, even by user lifecycle events.

### 5.10 Audit

`cloud_workspace_claim` is the audit record:

```text
who claimed:    claimed_by_user_id (may become NULL after user delete)
when:           claimed_at
provenance:     source_kind ('slack' | 'automation' | 'api' | 'manual')
```

For per-token revocation:

```text
cloud_workspace_claim_token.revoked_at + revoked_reason
```

No separate `cloud_workspace_admin_event` table. Admin actions are
limited to view (audit listing) and archive (workspace-level);
archive emits the existing workspace archive log.

### 5.11 Implementation notes for AnyHarness

```text
anyharness/crates/anyharness-lib/src/api/auth.rs               (new)
anyharness/crates/anyharness-lib/src/api/middleware/
  worker_or_user.rs           (new) classify + verify + AuthContext
  require_permission.rs       (new) permission gate
  scope_workspace.rs          (new) workspace scope gate
  scope_session.rs            (new) session scope gate
anyharness/crates/anyharness-lib/src/api/router.rs
  rewire routes to use the new middleware stack
anyharness/crates/anyharness-lib/src/api/revoked_jti.rs        (new)
```

Token classification, permissions enforcement, and scope check
mechanics are identical to the earlier draft of this spec; only the
top-level claim model has been simplified.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/claims.py                   (new)
  CloudWorkspaceClaim
  CloudWorkspaceClaimToken

server/alembic/versions/<NEW>_claiming.py
  - cloud_workspace_claim (UNIQUE on cloud_workspace_id)
  - cloud_workspace_claim_token
  - cloud_workspace_exposure.visibility CHECK remains
    ('private','shared_unclaimed','claimed','archived');
    'admin_managed' is dropped from the enum

server/proliferate/db/store/cloud_claims/                      (new)
  claims.py             insert_claim, load_claim_for_workspace,
                        list_claims_for_user
  tokens.py             insert/list/revoke/expire/prune

server/proliferate/server/cloud/claims/                        (new)
  api.py                claim + direct-attach + token-revoke endpoints
  service.py            claim insert + JWT issuance
  models.py             pydantic request/response
  access.py             can_claim, can_request_direct_attach, can_revoke_claim_token
  domain/policy.py      pure invariants
  domain/jwt.py         pure JWT claim builders

server/proliferate/server/cloud/workspaces/access.py
  - rewrite can_view_cloud_workspace, can_interact_cloud_workspace
    to consume cloud_workspace_exposure + cloud_workspace_claim

server/proliferate/server/cloud/workspaces/api.py
  - GET /workspaces?scope=my|unclaimed|org-all|claimable filters
  - GET /workspaces/{id} returns visibility + claimed_by_user_id +
    claim_id if a claim row exists

server/proliferate/server/cloud/commands/service.py
  - command enqueue checks can_interact_cloud_workspace; no admin
    interact override

server/proliferate/server/cloud/worker/api.py
  - GET /worker/revoked-jtis?since=      (worker pull from Cloud)

server/proliferate/server/cloud/claims/reconciler.py           (new)
  - sweep orphan claims (claimed_by_user_id IS NULL) for audit log
    (no transition)
  - prune expired claim tokens

server/proliferate/config.py
  - cloud_jwt_signing_key_pem
  - cloud_jwt_signing_key_id
  - cloud_jwt_verification_keys_json
  - cloud_jwt_issuer
  - cloud_jwt_audience_anyharness  default 'anyharness'
  - cloud_jwt_direct_attach_ttl_seconds  default 1200

dependencies:
  use existing python-jose[cryptography] / cryptography deps
```

Worker / AnyHarness (Rust):

```text
anyharness/crates/anyharness-contract/src/v1/auth.rs           (new)
  AuthContext shape exposed for handler trait
  Permission enum
  ClaimError, ScopeError typed responses

anyharness/crates/anyharness-lib/src/api/auth.rs               (new)
anyharness/crates/anyharness-lib/src/api/middleware/**         (new)
anyharness/crates/anyharness-lib/src/api/revoked_jti.rs        (new)
anyharness/crates/anyharness-lib/src/api/router.rs
anyharness/crates/anyharness-lib/src/app/mod.rs
  + runtime_target_id, claim verification keys, and RevokedJtiCache on AppState
  + cloud_jwt_audience: "anyharness"

anyharness/crates/proliferate-worker/src/cloud_client/revoked_jti.rs (new)
anyharness/crates/proliferate-worker/src/sync/revoked_jti.rs   (new)

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
apps/desktop/src/hooks/access/cloud/claims/                         (new)
  use-workspace-claim.ts
  use-claim-mutations.ts
  use-direct-attach-token.ts
  use-revoke-token.ts             per-token revoke for security

apps/desktop/src/lib/access/anyharness/runtime-target.ts
  - new runtime location 'shared_cloud' that uses
    cloud_target_runtime_access.anyharness_base_url +
    Bearer <direct-attach JWT>

apps/desktop/src/components/workspaces/*
  - "Claim" button in workspace headers when
    visibility='shared_unclaimed' AND user is org member
  - No "Release" button.
  - "Open in Desktop (direct)" CTA appears only when:
      claim is held by current user AND
      workspace.sandbox_type in ('managed_personal','managed_shared')
  - For admins viewing claimed-by-other work: "Audit view" mode
    that disables prompt input and shows a banner with
    "Claimed by Alice on Mar 12. To take over, archive and
    recreate."

apps/desktop/src/lib/storage/direct-attach-tokens.ts                (new)
  - store JWT in OS keychain
  - refresh on expiry
  - revoke on user logout
```

## 7. Implementation Chunks

```text
Chunk A  Cloud schema + claim service
  - cloud_workspace_claim + cloud_workspace_claim_token migrations
  - claims store
  - claims service (insert; JWT issuance; per-token revoke)
  - claims/access.py helpers (can_claim, can_request_direct_attach,
    can_revoke_claim_token)
  - claim + direct-attach + token-revoke API endpoints

Chunk B  Signing key config + verification-key delivery
  - config additions (cloud_jwt_*)
  - target bootstrap/runtime config carries accepted public keys to AnyHarness
  - test key overlap with two configured public keys

Chunk C  AnyHarness JWT verification
  - anyharness-lib/api/auth.rs classify+verify
  - middleware stack: worker_or_user, require_permission,
    scope_workspace, scope_session
  - AppState gains runtime_target_id + accepted claim verification keys
  - in-memory revoked-jti cache
  - PUT /v1/auth/revoked-jtis local AnyHarness endpoint

Chunk D  Worker revoked-jti reconciliation
  - worker pulls from Cloud (every 60s)
  - pushes hashed entries to AnyHarness on change

Chunk E  Workspace listing + access policy refactor
  - scope filters my | unclaimed | claimable | org-all
  - access helpers (can_view / can_interact / can_claim /
    can_request_direct_attach_token / can_revoke_claim_token)
  - cmd enqueue uses can_interact

Chunk F  Desktop direct-attach
  - claim mutation (one-way)
  - direct-attach-token + refresh + per-token revoke mutations
  - new runtime location 'shared_cloud'
  - JWT storage in OS keychain
  - UI: claim CTA, audit view for admin, "Open in Desktop (direct)"

Chunk G  Tests + smoke
```

## 8. Acceptance Criteria

1. `cloud_workspace_claim` has UNIQUE(`cloud_workspace_id`).
   Inserting a second claim row for the same workspace fails with
   `claim_already_held`.
2. There is no DELETE endpoint for the claim. The Cloud API surface
   contains no operation that transitions a workspace out of
   `claimed`.
3. Claim transition atomically inserts the claim row AND sets
   `cloud_workspace_exposure.visibility='claimed'`,
   `claimed_by_user_id=<user>`, and bumps `revision`, in one
   transaction.
4. `can_interact_cloud_workspace` returns false for admins on
   claimed workspaces (no admin interact override).
5. `can_view_cloud_workspace` returns true for admins on claimed
   workspaces (audit view).
6. Listing `scope=org-all` is admin-only and returns claimed and
   archived workspaces alongside others for audit.
7. `cloud_workspace_claim_token` stores only `token_jti_hash` plus optional
   prefix metadata; raw JWT bodies and raw `jti` values are never persisted.
8. Per-token revoke endpoint (`DELETE /workspaces/{id}/direct-access-tokens/{token_id}`)
   marks the token row `revoked` and pushes the token hash to AnyHarness.
   The claim itself is unaffected.
9. RS256 signing key configured via `cloud_jwt_signing_key_pem`.
   Accepted public keys are delivered to AnyHarness through target runtime
   config for rotation overlap.
11. AnyHarness `api/auth.rs` classifies tokens (JWT vs static
    bearer). Worker bearer is unchanged for worker traffic.
12. AnyHarness rejects JWTs whose `aud != 'anyharness'`,
    `iss != configured`, `target_id != configured runtime target id`, or
    `exp < now`.
13. Per-route middleware enforces permission and workspace/session
    scope. Worker tokens bypass scope.
14. Revoked-jti cache exists in AnyHarness; worker push + pull
    reconciliation both work; natural expiry handles routine
    rotation.
15. `POST /v1/cloud/workspaces/{id}/claim` is one-way. Repeated
    calls return `claim_already_held`.
16. `POST /v1/cloud/workspaces/{id}/direct-access-token` requires
    `X-Client-Kind: desktop`, an active claim by the calling user,
    and a managed-cloud target. Returns RAW JWT, JTI, expires_at,
    `anyharness_base_url`.
17. Web and mobile callers never receive a JWT. `X-Client-Kind`
    other than `desktop` gets 403 `direct_attach_desktop_only`.
18. Already-queued commands enqueued before a claim continue to
    lease. Future commands from non-claimers are rejected at
    enqueue with `claim_held_by_other`.
19. Desktop runtime location `shared_cloud` connects to
    `cloud_target_runtime_access.anyharness_base_url` with the
    JWT. AnyHarness scopes reads/writes to the JWT's workspace +
    session.
20. Signing-key overlap works with two configured public keys; zero downtime.
21. User deletion sets `claimed_by_user_id` to NULL on the claim
    row and the exposure; the reconciler logs an audit event but
    does not transition the workspace state.
22. `admin_managed` is not a valid value of
    `cloud_workspace_exposure.visibility`. The CHECK constraint
    rejects it.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests:

```text
server/tests/cloud/claims/test_claim_one_way.py
  - first claim succeeds
  - second claim returns claim_already_held
  - no release/revoke endpoint exists

server/tests/cloud/claims/test_claim_transition_atomic.py
server/tests/cloud/claims/test_claim_token_jti_unique.py
server/tests/cloud/claims/test_token_refresh_caps_at_five.py
server/tests/cloud/claims/test_per_token_revoke.py
  - revoking a token does not transition exposure.visibility
server/tests/cloud/claims/test_jwt_claims_shape.py
server/tests/cloud/claims/test_signing_key_overlap.py
server/tests/cloud/access/test_admin_view_yes_interact_no.py
server/tests/cloud/access/test_can_claim_excludes_non_org_member.py
server/tests/cloud/commands/test_command_rejected_post_claim_non_claimer.py
server/tests/cloud/commands/test_queued_command_preclaim_proceeds.py
server/tests/cloud/workspaces/test_list_scope_my.py
server/tests/cloud/workspaces/test_list_scope_unclaimed.py
server/tests/cloud/workspaces/test_list_scope_org_all_admin_only_audit.py
server/tests/cloud/worker/test_revoked_jti_push_and_pull.py
server/tests/cloud/claims/test_direct_attach_desktop_only_header.py
server/tests/cloud/claims/test_direct_attach_token_returns_runtime_access.py
server/tests/cloud/claims/test_user_delete_sets_null_no_transition.py
server/tests/cloud/exposures/test_admin_managed_visibility_rejected.py
```

AnyHarness:

```bash
cargo test -p anyharness-contract
cargo test -p anyharness-lib api::auth
cargo test -p anyharness-lib api::middleware
cargo test -p anyharness-lib api::revoked_jti
```

Targeted Rust tests are identical to the prior draft (token
classification, JWT happy/error paths, scope middleware, revoked
jti cache).

Desktop:

```bash
cd apps/desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
apps/desktop/src/hooks/access/cloud/claims/use-workspace-claim.test.ts
  - claim mutation hits POST /claim
  - no release mutation exists
apps/desktop/src/hooks/access/cloud/claims/use-direct-attach-token.test.ts
apps/desktop/src/lib/access/anyharness/runtime-target.test.ts
  - shared_cloud target uses cloud_target_runtime_access + JWT
apps/desktop/src/lib/storage/direct-attach-tokens.test.ts
apps/desktop/src/components/workspaces/AdminAuditView.test.tsx
  - admin sees claimed-by-other workspace
  - prompt input disabled
  - banner shows claimed_by + claimed_at
```

Manual smoke:

```text
1. Slack creates shared work; org member claims; nobody can undo
   - visibility shared_unclaimed -> claimed
   - other org members lose interact via Cloud (see audit view as
     admin)
   - claimer's web/mobile/Slack continue via Cloud
   - claimer's Desktop calls direct-attach-token; opens shared_cloud
   - admin tries DELETE /claim -> 404 / 405 (no such endpoint)

2. Claimer requests a fresh token (lost Desktop)
   - claimer DELETE /direct-access-tokens/{old} -> token revoked
   - claimer POST /direct-access-token -> new token issued
   - old token rejected by AnyHarness via revoked-jti cache
   - claim itself unaffected

3. User leaves the org / account deleted
   - claimed_by_user_id SET NULL on claim row + exposure
   - workspace remains visibility='claimed'
   - admin sees it in scope=org-all with "claimed by (deleted)" label
   - admin can archive the workspace (workspace-level retention
     action)

4. Concurrent prompts from Desktop direct + Cloud
   - both prompts reach the same AnyHarness session loop
   - serialized; both appear in transcript

5. Signing-key overlap
   - operator adds new signing key as active; previous key kept
   - target config delivers both public keys to AnyHarness
   - tokens signed with new key verify
   - tokens signed with previous key (still in TTL) verify
   - after previous key removed from config and local key set updated, old
     tokens fail

6. Web/mobile cannot get JWT
   - X-Client-Kind != 'desktop' -> 403 direct_attach_desktop_only
```

## 10. Final Decisions / Deferred Questions

1. **Token TTL: 20 minutes default, configurable. Right value?**

   Tradeoffs:
     short  better per-token revocation latency, more refresh traffic
     long   fewer refresh, slower per-token revocation (until natural
            expiry); push-cache mitigates

   Decision: 20 minutes. With push-based jti revocation cache,
   immediate cutoff is supported anyway.

2. **`X-Client-Kind: desktop` gate hardening**

   The header is spoofable. A user with a valid claim could
   request the JWT from a non-Desktop client. The downside is
   bounded: the JWT only works against the AnyHarness URL, which
   is not exposed to web/mobile UI (no AnyHarness HTTP client).
   Still, "spoofable" is a real concern.

   Options:
     (a) Tie to Desktop OAuth client_id
     (b) Require a Desktop-only auth method (e.g. session token
         issued by the Desktop installer)
     (c) Accept the spoofability since attack surface is small

   Decision: (c) for V1. Move to (a) when Desktop OAuth client
   identity exists. Track as a follow-up.

3. **Signing-key rotation operations**

   The spec defines the model (active signing key + accepted verification key
   set). Key generation, rotation cadence, and operator runbook live in
   deployment docs. Decision: don't bloat the spec; reference the deployment doc
   when written.

4. **Admin viewing a claimed workspace's transcript — read or
   read+events?**

   Admin gets `can_view` for audit. Should admin also see live
   event projection or just static transcript? Decision: full live
   projection (events stream) but no interaction. Implementation
   already supports this via projection_level + commandable; the
   admin path uses the same projection_level=live, commandable=false
   for their view session. No extra schema needed.

5. **What if the claimer's user account is reinstated after
   `claimed_by_user_id` became NULL?**

   Decision: do not auto-restore. If a deleted user is reinstated and
   their claim was orphaned, the workspace remains orphan-claimed
   with NULL claimer. Admin manually archives or the user creates
   new work. Reactivation would require explicit product UX which
   we don't have.

6. **`cloud_workspace_claim.cloud_session_id` — necessary?**

   The claim is workspace-scoped. The captured session id is just
   "the session at claim time" for UI deep-link convenience. If we
   never use it, we can drop the column.

   Decision: keep. It costs almost nothing and lets the post-claim UI
   route the user back to the session they were looking at when
   they clicked Claim.
