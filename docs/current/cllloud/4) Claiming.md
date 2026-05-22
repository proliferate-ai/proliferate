## High level model

Claiming means:

```text
This shared cloud workspace/session is now owned by this user.
```

It is primarily a Cloud ownership and visibility transition. It also enables
Desktop direct access to the shared sandbox's AnyHarness for that specific
claimed workspace/session.

Claiming is not projection and not migration. Shared work is already exposed to
Cloud before claim. Claiming changes who can see/control that exposed work.

Web/mobile do not get direct AnyHarness access tokens. They keep using Cloud
APIs and Cloud-mediated commands. Desktop is the direct AnyHarness client.

Before claim:

- workspace/session is org-owned shared work;
- visible in team/unclaimed work lists to all org members;
- interactable by all org members through Cloud-mediated APIs;
- has an active Cloud exposure/projection;
- controlled by Cloud through the worker;
- direct AnyHarness access by users is denied.

After claim:

- Cloud records the claiming user;
- workspace/session disappears from the unclaimed team pool;
- claimed user sees it in their own work list;
- Cloud-mediated interaction is restricted to the claiming user, plus admins
  for manage/audit actions;
- admins can still see it for audit/manage;
- exposure/projection continues under the same target/session unless moved;
- Desktop can request a short-lived direct AnyHarness access token scoped only
  to that workspace/session.

## DB models + schemas

```text
cloud_workspace_claim
  id
  organization_id
  target_id
  exposure_id
  cloud_workspace_id
  anyharness_workspace_id
  cloud_session_id
  anyharness_session_id
  claimed_by_user_id
  source_kind: slack | automation | api | manual
  status: active | released | revoked
  claimed_at
  released_at
  revoked_at
  created_at
```

Claim rows should reference exposed work. The active
`cloud_workspace_exposure` remains the policy/admission object for projection
and Cloud-mediated dispatch. Claiming updates exposure visibility/control fields
such as `visibility = claimed`, `claimed_by_user_id`, and `commandable` policy.

```text
cloud_workspace_claim_token
  id
  claim_id
  token_jti_hash
  issued_to_user_id
  target_id
  anyharness_workspace_id
  anyharness_session_id
  permissions
  status: active | revoked | expired
  issued_at
  expires_at
  last_used_at
  revoked_at
```

Cloud stores a durable token row for audit/revocation/visibility, but never
stores the raw JWT. Desktop stores the raw JWT locally until expiry. Token
refresh creates a new token row.

Useful constraints:

- one active claim per shared workspace/session;
- active claim requires org membership;
- claim target/workspace/session must belong to the same org;
- releasing/revoking claim stops new token issuance and revokes active token rows;
- raw JWTs are never stored in Cloud.

Access states:

```text
shared_unclaimed
  owner_scope = organization
  visible to every org member
  interactable by every org member through Cloud APIs
  direct AnyHarness user access denied

claimed
  hidden from shared/unclaimed pool
  visible/interactable by claimed user
  visible to admins for audit/manage
  Desktop direct AnyHarness access allowed only with scoped claim token

archived
  visible only by retention/audit rules
```

## Direct access token

Only Desktop requests this token.

```text
POST /cloud/workspaces/{workspace_id}/claim
  creates/returns active claim for current user

POST /cloud/workspaces/{workspace_id}/direct-access-token
  Desktop only
  requires active claim by current user
  returns short-lived JWT for direct AnyHarness connection
```

JWT claims:

```text
sub = user_id
org_id
target_id
cloud_workspace_id
anyharness_workspace_id
cloud_session_id optional
anyharness_session_id optional
claim_id
permissions: read | write | control
aud = anyharness
exp = 15-30m
jti
```

AnyHarness validates:

- signature from Cloud public key/JWKS or pinned public key;
- audience is `anyharness`;
- target id matches this target;
- requested workspace/session matches token scope;
- permission covers the action;
- token not expired;
- optional revoked-jti cache does not contain `jti`.

## End to end flows through the product

Claim Slack/automation work:

1. Slack or team automation creates org-owned shared workspace/session.
2. Cloud shows it in the unclaimed team work list.
3. User clicks Claim.
4. Cloud verifies org membership and policy.
5. Cloud creates `cloud_workspace_claim`.
6. Work is hidden from unclaimed team list.
7. Work appears in claiming user's list.
8. Web/mobile continue to control it through Cloud.
9. Desktop can request a direct AnyHarness token for it.

Desktop direct attach:

1. Desktop loads claimed workspace/session from Cloud.
2. Desktop calls `direct-access-token`.
3. Desktop connects to shared sandbox AnyHarness with `Authorization: Bearer`.
4. AnyHarness validates token and scope.
5. AnyHarness allows access only to the claimed workspace/session.

Release/revoke:

1. User releases or admin revokes claim.
2. Cloud marks claim released/revoked.
3. Cloud stops issuing direct-access tokens.
4. Existing tokens expire quickly.
5. Optional worker-pushed revoked-jti cache cuts off active tokens earlier.
6. Work returns to unclaimed pool or archive depending policy.

## Hooks / things used and why

Every Cloud API that reads or mutates shared work should use the same access
helpers, including long-poll/command endpoints:

```text
can_view_cloud_workspace(user, workspace)
can_interact_cloud_workspace(user, workspace)
can_claim_cloud_workspace(user, workspace)
can_request_direct_anyharness_token(user, workspace)
```

Cloud list/read gates:

```text
shared_unclaimed work list
  -> owner_scope = organization
  -> no active claim
  -> current user is org member

my work list
  -> personal work owned by current user
  -> claimed shared work where claimed_by_user_id = current user

admin/audit list
  -> org admin can see all org work, including claimed work
  -> audit/manage actions only unless admin explicitly claims/transfers
```

Cloud mutation gates:

```text
send_prompt / resolve_interaction / update_session_config / cancel_turn / close
  -> can_interact_cloud_workspace
  -> active exposure exists
  -> active session projection exists for session commands
  -> commandable = true
  -> shared_unclaimed: any org member
  -> claimed: claiming user only
  -> admin: audit/manage only unless policy allows admin intervention

claim
  -> can_claim_cloud_workspace
  -> org member
  -> shared_unclaimed
  -> no active claim

direct-access-token
  -> can_request_direct_anyharness_token
  -> active claim by current user
  -> Desktop client only
```

Cloud-mediated commands such as `send_prompt`, `resolve_interaction`,
`cancel_turn`, `update_session_config`, and `close_session` must pass the Cloud
gate before enqueueing worker commands. The command should carry enough target,
workspace, session, exposure, projection, and claim metadata for
audit/precondition checks, but the worker does not make org access decisions.

Dispatch invariant:

```text
No Cloud-mediated command without active exposure.
No commandable shared work without active projection.
Claiming changes access policy, not projection mechanics.
```

AnyHarness auth hook:

```text
direct user request arrives
  -> parse bearer token
  -> validate Cloud signature/JWKS
  -> validate aud = anyharness
  -> validate target_id matches this target
  -> validate exp/jti/revocation cache
  -> attach user auth context
  -> endpoint checks workspace/session scope before action
```

Worker auth remains separate:

```text
worker token
  can manage target and execute Cloud commands

user claim token
  can directly access only claimed workspace/session
```

AnyHarness route gates:

```text
runtime/admin/target config endpoints
  -> worker/service token only

workspace/session list endpoints
  -> worker/service token: target-wide
  -> user claim token: filtered to token-scoped workspace/session only

workspace/session read endpoints
  -> user claim token allowed only for scoped workspace/session

prompt / resolve interaction / update config / cancel / close
  -> user claim token needs write/control permission
  -> workspace/session must match token scope

MCP/runtime config refresh, agent auth refresh, worker command apply
  -> worker/service token only
```

Claim-change command behavior:

```text
if work is unclaimed when command is enqueued
  and becomes claimed before command leases:
    command precondition fails unless caller is the claiming user

if command carries an old exposure_revision:
  Cloud or worker reports it as stale/superseded
  caller must re-read workspace access/projection state

if claim is revoked/released:
  Cloud stops issuing direct tokens
  AnyHarness eventually rejects active tokens by expiry
  optional revoked-jti push cuts them off sooner
```

Desktop token storage:

```text
Desktop stores raw direct-access JWT durably, preferably in OS secure storage.
Cloud stores only token_jti_hash and metadata.
Desktop refreshes through Cloud while claim is active.
```

## One offs

- Claiming is not migration; it does not move files or sessions.
- Claiming should not mutate original org ownership/billing/audit history.
- Claiming changes visibility and direct-access authority.
- Web/mobile never need the direct AnyHarness JWT.
- Desktop token TTL should be short, with refresh through Cloud while claim is
  active.
- Direct reachability to shared sandbox is not authority.

## Deeper concepts

Cloud is product authority:

- decides who can claim;
- records active claim;
- issues Desktop-only direct tokens.

AnyHarness is local runtime authority:

- validates Cloud-signed token;
- enforces workspace/session scope;
- does not decide org membership or claim policy itself.
