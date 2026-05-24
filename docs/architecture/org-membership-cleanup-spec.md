# User And Organization Membership Cleanup Spec

Status: proposed implementation spec
Date: 2026-05-24
Branch: codex/org-membership-cleanup-spec
Scope: Users + Org cleanup only

## Executive Summary

Proliferate should treat a user account and an organization as separate
concepts.

A user can exist without an organization. A user may belong to at most one
active organization at a time. Organizations are not auto-created at signup or
login. An organization is created when a user starts a Team plan purchase, and it
becomes active only when the Team subscription is activated. Once active, that
organization unlocks team capabilities: members, invites, shared sandbox,
shared auth surfaces, shared automations, Slackbot, and org billing.

The current code does not enforce those rules. Today, the server auto-creates a
default organization when listing organizations, the data model allows a user to
have active memberships in multiple organizations, and the frontend carries
multi-org selectors and product-facing "personal billing" language. This spec
replaces that mental model with:

- Zero or one active organization per user.
- No default organization creation.
- Org billing only as the product billing model.
- Free user allocations and free LLM credits as user entitlements, not personal
  billing.
- Team subscription activation as the only normal organization creation path.
- Invite acceptance as a guarded transition that fails if the user already
  belongs to another active organization.
- Shared sandbox creation as part of organization activation.

This is the first slice of a broader program:

1. Users + Org cleanup.
2. BYOK + LiteLLM cleanup and initial free credit provisioning.
3. Full billing cleanup.

This document covers slice 1 and names the integration seams that slices 2 and 3
will use.

## Docs And Code Reviewed

Docs read before writing this spec:

- `docs/README.md`
- `docs/server/README.md`
- `docs/server/guides/database.md`
- `docs/server/guides/auth.md`
- `docs/server/guides/domains.md`
- `docs/frontend/README.md`

Representative code paths reviewed:

- `server/proliferate/db/models/organizations.py`
- `server/proliferate/db/store/organizations.py`
- `server/proliferate/db/store/organization_invitations.py`
- `server/proliferate/server/organizations/service.py`
- `server/proliferate/server/organizations/api.py`
- `server/proliferate/db/models/billing.py`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/db/store/cloud_agent_auth/store.py`
- `server/proliferate/server/cloud/sandbox_profiles/api.py`
- `desktop/src/hooks/organizations/facade/use-active-organization.ts`
- `desktop/src/stores/organizations/organization-store.ts`
- `desktop/src/components/settings/panes/OrganizationPane.tsx`
- `desktop/src/components/settings/panes/BillingPane.tsx`
- `desktop/src/components/settings/panes/SlackBotPane.tsx`
- `web/src/components/settings/screen/SettingsScreen.tsx`
- `web/src/components/settings/screen/BillingSettingsSection.tsx`
- `cloud/sdk/src/client/organizations.ts`
- `cloud/sdk-react/src/hooks/organizations.ts`

## Product Terms

### User Account

A personal identity in Proliferate. It can sign in, use free included user
allocations, connect personal credentials, and launch personal cloud work where
allowed by entitlement.

A user account is not an organization.

### Organization

A paid team container. It owns team membership, invites, org billing, shared
sandbox configuration, shared credentials, shared automations, Slack
configuration, team workspaces, and team admin state.

Organizations are product-facing teams. In UI copy, "Team" can be used where it
is clearer, but server and database naming can remain "Organization."

### Active Organization Membership

The current relationship that gives a user access to an organization.

Invariant: a user has zero or one active organization membership.

Historical memberships may remain in the database with `removed` status. They do
not count as current membership.

Important distinction:

- A membership can be active even when the organization itself is in a restricted
  lifecycle state such as `suspended`.
- That active membership still blocks the user from joining or creating another
  organization.
- Organization usability for launches and shared work is a separate lifecycle
  question.

### Free User Allocations

Free cloud minutes and free LLM credits granted to a user account for onboarding
and trial usage.

These are not called "personal billing" in the product. They may temporarily use
existing billing ledger internals during migration, but the user-facing concept
is free allocation or credits.

### Org Billing

The only product billing concept. A Team plan creates or activates an
organization. Seats are billed from active organization memberships. Team
features are configured through the organization.

### Shared Sandbox

The team-managed cloud execution environment for organization work. The shared
sandbox is created or ensured during organization activation, then configured by
admins in shared/team settings.

## Goals

1. Stop creating default organizations automatically.
2. Enforce that users can belong to zero or one active organization.
3. Make Team subscription creation the normal path to creating an organization.
4. Make invite acceptance safe and deterministic under the zero-or-one-org rule.
5. Keep organization billing as the only product-facing billing model.
6. Preserve free user onboarding credits without exposing personal billing.
7. Initialize shared sandbox state when a Team organization becomes active.
8. Remove multi-org selection UX from web and desktop.
9. Provide clean API and model seams for BYOK, LiteLLM, shared auth, and full
   billing cleanup in later slices.

## Non-Goals

This slice does not implement:

- BYOK or LiteLLM provider cleanup.
- Enterprise LiteLLM deployment changes.
- Final free LLM credit grant mechanics.
- Full Stripe pricing, overage, invoice, or seat billing cleanup.
- Org deletion or data retention policy.
- Multi-organization support.
- Transferring users between organizations without leaving the old org first.
- Shared sandbox admin UX redesign beyond the activation dependency.

## Current State

### Current Organization Model

`Organization` currently has:

- `id`
- `name`
- `logo_domain`
- `logo_image`
- timestamps

It does not have an explicit lifecycle status.

`OrganizationMembership` currently has:

- `organization_id`
- `user_id`
- `role`
- `status`
- timestamps

The only uniqueness constraint is on `(organization_id, user_id)`. That prevents
duplicate membership rows in the same organization, but it does not prevent a
user from having active memberships in multiple organizations.

### Current Auto-Creation Behavior

`server/proliferate/server/organizations/service.py` calls
`ensure_default_organization_for_user` when listing organizations.

This means a user who only asks "what organizations do I have?" can be placed
into a newly created default organization. That directly conflicts with the
target rule that users should have no organization until they pay for or join
one.

### Current Invitation Behavior

Invitation acceptance creates or reactivates a membership in the invited
organization. It does not check whether the user is already an active member of
another organization. With the current database constraints, two simultaneous or
sequential invite acceptances can put a user into multiple active organizations.

### Current Billing Shape

The billing schema supports both personal and organization billing subjects.
Several current flows create or resolve personal billing subjects for free cloud
grants and usage ledger records.

That is an implementation detail we may preserve temporarily. Product UX should
not describe this as personal billing. The product model should be:

- Free user allocations for users.
- Org billing for Teams.

Full internal billing cleanup is slice 3, but slice 1 must avoid adding new
product or API behavior that depends on personal billing as a first-class
customer concept.

### Current Frontend Shape

Desktop and web both assume organization lists can contain multiple
organizations:

- Desktop stores an `activeOrganizationId`.
- Desktop organization settings can render an active organization selector.
- Desktop billing settings describe "personal and organization cloud usage."
- Web settings show a Teams list.
- Web billing settings show "Personal billing" and org billing sections.
- Several settings panes pick the first organization from a list.

This should become a single current organization model.

## Target Invariants

### User Invariants

- A user can have zero active organizations.
- A user can have one active organization.
- A user cannot have two active organizations.
- A user can keep historical removed memberships.
- A user can receive invites while already in an organization, but cannot accept
  an invite to a different organization until they leave or are removed from the
  current organization.

### Organization Invariants

- An organization is not auto-created at signup, login, or organization list.
- A Team checkout can create a pending organization record.
- A pending organization is not returned as the user's active organization.
- An organization becomes active only after successful Team subscription
  activation.
- An active organization has exactly one owner membership at activation and at
  least one active owner thereafter.
- An active organization has an organization billing subject.
- An active organization has an ensured shared sandbox profile and primary target
  shell.

### Billing Invariants

- Org billing is the only product-facing billing model.
- Active organization memberships determine billable seats, with the Team
  quantity floored at one for active or pending paid subscriptions.
- Free user allocations do not create an organization.
- Free user allocations are described as credits or included usage, not
  personal billing.
- Existing personal billing subject internals may remain temporarily as a ledger
  compatibility mechanism.

### API Invariants

- `GET /v1/organizations` must not create organizations.
- Organization list for a user returns zero or one current organization:
  `active` for usable teams, `suspended` for billing/policy repair states.
- New code should prefer a current-organization abstraction instead of active
  org selectors.
- Invite acceptance must be concurrency-safe.
- Team activation must be idempotent across Stripe webhook retries.

## Target Lifecycle

### New User Signup

1. User signs up or logs in.
2. Server creates or finds the user identity.
3. Server preserves the existing lazy free cloud allocation behavior and exposes
   it as account credits or included usage.
4. Server does not create an organization.
5. Settings shows no organization and offers:
   - Start a Team plan.
   - Accept a pending invite, if one exists.

### Create Team

1. User chooses "Create team" or "Start Team plan."
2. User enters team name and optional invite emails.
3. Server creates a pending Team checkout intent.
4. Server creates a pending organization shell for the intent.
5. Server creates or ensures the organization billing subject.
6. Server creates a Stripe checkout session for the Team plan.
7. User completes payment.
8. Stripe webhook activates the Team intent.
9. Activation creates the owner membership for the paying user.
10. Activation marks the organization active.
11. Activation syncs subscription state to the organization billing subject.
12. Activation ensures the organization shared sandbox profile and primary
    target shell.
13. User returns to Proliferate and now sees the active team.

### Join Team By Invite

1. Admin invites an email address.
2. Invited user signs in.
3. User sees the pending invite.
4. User accepts.
5. Server checks whether the user already has an active membership.
6. If the user has no active organization, server activates membership in the
   invited organization.
7. Server queues or reconciles organization seat count.
8. User now sees the team.
9. If the user already belongs to a different organization, server returns a
   conflict explaining that the user must leave the current team before joining
   another.

### Leave Or Remove User

1. Admin removes a member, or a member leaves if allowed.
2. Membership status changes from `active` to `removed`.
3. Seat count is reconciled.
4. If this removal would remove the last owner, it is blocked.
5. If the removed user has no other active membership, they return to the no-org
   state.

## Data Model Changes

### Organization Status

Add `status` to `organizations`.

Recommended enum values:

- `pending_checkout`: created for Team checkout, not yet usable.
- `active`: usable organization.
- `suspended`: organization exists, but team execution and admin mutation are
  limited because billing or policy requires attention.
- `archived`: hidden from normal product surfaces.

Current-team semantics:

- `pending_checkout` does not count as the user's team because no membership has
  been created yet.
- `active` counts as the user's current team and is usable.
- `suspended` counts as the user's current team for membership uniqueness and UX,
  but shared launches and admin mutations are restricted.
- `archived` does not count as current membership for product UX.

Slice 1 should add the status model and status-aware helpers. It does not need to
fully implement every future suspension policy. If `suspended` is emitted in
slice 1, it must be visible in Organization/Billing settings and must block
creating or joining another team.

Rationale:

- The current model has no way to distinguish an active team from an
  auto-created shell or a checkout-in-progress shell.
- Team creation needs a durable object before Stripe returns.
- Suspended and archived states make billing and future cancellation flows
  explicit without overloading membership status.

### Organization Membership Constraint

Keep the existing unique constraint on `(organization_id, user_id)`.

Add a partial unique index:

```sql
CREATE UNIQUE INDEX uq_organization_membership_active_user
ON organization_membership (user_id)
WHERE status = 'active';
```

Also add the matching SQLAlchemy `Index` on the existing
`organization_membership` table.

This index is the final line of defense. Service code must still check and
return friendly errors, but the database must make the invariant impossible to
violate under race conditions.

Before the index is installed, all membership-activating flows must use the same
user-scoped activation lock described below. The lock remains after the index is
installed so users get deterministic product errors instead of raw integrity
errors.

### Membership Activation Lock

Any flow that can create or reactivate an active organization membership must
take a user-scoped transaction lock before checking current membership:

- Team checkout activation.
- Invitation acceptance.
- Member reactivation.
- Future transfer or claim flows.

Recommended implementation:

- Use a Postgres advisory transaction lock keyed by
  `organization-membership-active-user:{user_id}`.
- Take the lock before reading the user's active memberships.
- Keep the lock until the membership mutation commits or rolls back.
- Catch the partial unique index `IntegrityError` as a final defense and map it
  to the same 409 conflict returned by the optimistic check.

This is required even before the partial index is installed because current
invite acceptance only locks the invitation row, and two different invitations
or an invitation plus checkout activation can otherwise race.

### Team Checkout Intent

Add a durable checkout intent table.

Suggested model: `OrganizationCheckoutIntent`.

Fields:

- `id`
- `organization_id` with FK to `organization.id`
- `created_by_user_id` with FK to the user table
- `team_name`
- `status`
- `stripe_checkout_session_id`, unique when non-null
- `stripe_customer_id`
- `stripe_subscription_id`, indexed and unique when non-null if Stripe
  guarantees one checkout intent per Team subscription
- `billing_subject_id`
- `idempotency_key`, unique
- `invite_emails_json` or a related invite staging table
- `activation_status`
- `activation_error_code`
- `activation_error_message`
- `last_webhook_event_id`
- `expires_at`
- `completed_at`
- `failed_at`
- `cancelled_at`
- `created_at`
- `updated_at`

Suggested statuses:

- `pending`
- `completed`
- `expired`
- `cancelled`
- `failed`

Suggested activation statuses:

- `not_started`
- `activating`
- `activated`
- `failed_business_state`
- `failed_billing_state`
- `failed_internal`

Indexes and constraints:

- Unique `idempotency_key`.
- Unique nullable `stripe_checkout_session_id`.
- Index `(created_by_user_id, status)`.
- Index `(organization_id, status)`.
- At most one non-terminal checkout intent per creator. This can be enforced by
  a partial unique index on `created_by_user_id` where `status IN ('pending')`,
  or by the same user-scoped activation lock plus service checks if partial
  enum indexes are awkward in the migration stack.

The intent lets us:

- Create a pending organization without making the user a member yet.
- Retry webhooks safely.
- Recover from checkout redirect failures.
- Avoid using membership rows as a checkout staging mechanism.
- Attach Stripe metadata to a known local object.
- Store business-state activation failures before acknowledging Stripe.
- Resume or cancel checkout without exposing pending organizations in the
  organization list.

Stripe I/O rule:

- Generate and commit the local intent before creating a Stripe Checkout
  Session.
- Include the intent id in all Stripe metadata.
- After Stripe returns the session, persist the session id.
- If persisting the Stripe session id fails, create a new local recovery state
  and surface "checkout setup failed, try again" to the user. Do not hold a
  database transaction open across Stripe network calls.

### Free User Credits

No new table is required in slice 1 unless the existing billing ledger cannot
represent onboarding credits without leaking personal billing into API output.

Target rule:

- Server internals may continue to write personal-like ledger rows for free user
  allocations.
- Public billing APIs and frontend copy should expose them as free credits,
  included usage, or account credits.
- No organization is created to represent those credits.

Slice 1 preserves existing lazy free cloud allocation behavior. It does not
promise new eager free LLM credit provisioning. Slice 2 should define BYOK,
LiteLLM, and initial LLM credit mechanics. Slice 3 should decide whether to
introduce a dedicated user entitlement table and retire personal billing
subjects internally.

## Server Changes

### Organization Listing

Change `list_organizations` so it:

- Does not call `ensure_default_organization_for_user`.
- Returns organizations where the user has an active membership and the
  organization lifecycle is `active` or `suspended`.
- Returns zero or one organization after the migration is complete.
- Ensures no organization billing subject as a side effect.

Compatibility:

- The endpoint can keep returning an array for SDK compatibility.
- SDK React should expose a `useCurrentTeam` helper that maps `[]` to
  `null` and `[org]` to the organization.
- Before remediation is complete, if more than one active membership is found,
  server should return a data-integrity conflict in development/staging and log
  a high-severity production event. Do not silently choose one for mutation
  flows.
- UI migrations should keep the existing list response shape until all deployed
  clients can handle `[]`.

### Current Membership And Organization Helpers

Add two separate helpers. The distinction is important.

```python
async def load_current_membership_for_user(
    db,
    user_id: str,
) -> CurrentOrganizationMembershipRecord | None:
    ...

async def load_current_usable_organization_for_user(
    db,
    user_id: str,
) -> CurrentOrganizationRecord | None:
    ...
```

`load_current_membership_for_user` should:

- Look for one active membership.
- Join organization.
- Treat `active` and `suspended` organizations as current teams for membership
  uniqueness.
- Return `None` only when no active membership exists in a non-archived,
  non-pending organization.
- Raise a data-integrity error if multiple active rows are observed before the
  partial unique index is installed.

Use this helper for:

- Create Team checkout eligibility.
- Invite acceptance conflicts.
- Membership reactivation conflicts.
- Any flow that asks "does this user already belong to a team?"

`load_current_usable_organization_for_user` should:

- Call or mirror the current membership helper.
- Return the organization only when status is `active`.
- Return a structured restricted result, not `None`, if the organization is
  `suspended` and the caller needs billing repair UX.

Both helpers should return frozen store dataclasses, not ORM objects. Pydantic
response models should be built in API/model layers according to the server
database guide.

Use these helpers anywhere code currently picks the first organization from a
list, but do not use "current organization" as a substitute for authorization on
routes that accept an explicit `organization_id`.

### Removing Default Organization Creation

Deprecate `ensure_default_organization_for_user`.

Do not delete immediately if tests or old call sites still reference it. Instead:

1. Remove all production call sites.
2. Rename or mark it as test-only if still needed for fixtures.
3. Add a failing test that proves list organizations has no creation side
   effect.
4. Delete the helper once fixtures have dedicated factories.

### Create Team Checkout

Add a server command that creates a Team checkout intent.

Recommended endpoint:

```http
POST /v1/billing/team-checkout
```

Request:

```json
{
  "teamName": "Acme Research",
  "inviteEmails": ["teammate@example.com"]
}
```

Response:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/...",
  "intentId": "orgci_..."
}
```

Server behavior:

1. Authenticate user.
2. Take the user-scoped membership activation lock.
3. Verify user has no current active membership in an `active` or `suspended`
   organization.
4. Verify the user has no non-terminal Team checkout intent, or return the
   existing resumable intent.
5. Create pending organization with `status = 'pending_checkout'`.
6. Create or ensure organization billing subject.
7. Create checkout intent and commit it before Stripe I/O.
8. Create Stripe checkout session for Team plan using server-owned, allowlisted
   success and cancel URLs. Do not accept arbitrary redirect URLs from the
   client.
9. Put metadata on both the Checkout Session and `subscription_data.metadata`:
   - `purpose = team_subscription`
   - `billing_subject_id`
   - `organization_id`
   - `organization_checkout_intent_id`
   - `created_by_user_id`
10. Store Stripe checkout session id on the intent.
11. Return checkout URL.

Do not create the owner membership before payment succeeds.

Every Team CTA in web and desktop should enter this flow. It should not call the
older generic `createCloudCheckoutSession` path directly.

### Pending Team Checkout Recovery

Add creator-only endpoints for checkout recovery:

```http
GET /v1/billing/team-checkout/current
POST /v1/billing/team-checkout/{intent_id}/cancel
```

`GET current` returns:

```json
{
  "intent": {
    "id": "orgci_...",
    "teamName": "Acme Research",
    "status": "pending",
    "checkoutUrl": "https://checkout.stripe.com/...",
    "expiresAt": "..."
  }
}
```

Rules:

- Only the creator can see or cancel a pending intent.
- Pending organizations are never returned from organization list.
- Cancel marks the intent `cancelled` and the pending organization `archived`.
- Expired sessions mark the intent `expired`; the user can start again.
- If activation failed for a business-state reason, return the failure code and
  support-facing message without retrying activation from the client.

The web and desktop Organization pages use this endpoint to render "Continue
checkout" and "Cancel setup."

### Activate Team Checkout

Add an idempotent activation service:

```python
async def activate_team_checkout_intent(
    db,
    *,
    intent_id: str,
    stripe_checkout_session_id: str | None,
    stripe_subscription_id: str | None,
) -> ActivatedOrganizationRecord:
    ...
```

Activation behavior:

1. Lock the checkout intent row.
2. Take the user-scoped membership activation lock for `created_by_user_id`.
3. If already completed, return the active organization record.
4. Verify the intent is still pending.
5. Verify the organization is still `pending_checkout`.
6. Verify the creating user has no current active membership in any `active` or
   `suspended` organization.
7. Retrieve or consume the Stripe subscription from the checkout session.
8. Validate:
   - Checkout Session metadata matches intent id, organization id, creator id,
     and billing subject id.
   - Subscription metadata matches the same identifiers.
   - Subscription is for the Team price.
   - Subscription status is healthy enough to activate, for example `active` or
     `trialing`.
9. Upsert the Stripe subscription into `BillingSubscription` and bind customer
   and subscription ids to the organization billing subject.
10. Mark organization `active`.
11. Upsert owner membership for `created_by_user_id` with:
   - `role = owner`
   - `status = active`
12. Ensure organization shared sandbox profile and primary target shell through
   an activation-safe cloud sandbox profile service helper.
13. Create staged invites, if invite emails were provided.
14. Mark checkout intent completed and `activation_status = activated`.
15. Commit.

If the creator joined another organization between checkout start and checkout
completion, activation should fail into a recoverable support state:

- Keep the organization pending or archive it, depending on whether support can
  recover payment state.
- Mark checkout intent `failed`.
- Set `activation_status = failed_business_state`.
- Set `activation_error_code = creator_already_in_organization`.
- Store the Stripe event id in `last_webhook_event_id`.
- Do not create a second active membership.
- Log with Stripe session and user id.
- Show a product error asking the user to contact support or leave the current
  team and retry.

The database partial unique index will also prevent double activation.

### Stripe Webhooks

Update checkout handling so Team checkout completion is recognized separately
from one-off credit refill sessions.

Required webhook behavior:

- `checkout.session.completed` with `purpose = team_subscription` calls
  `activate_team_checkout_intent`.
- `purpose = team_subscription` must be accepted only when metadata contains the
  expected checkout intent id, organization id, created-by user id, and billing
  subject id.
- Subscription sync remains idempotent.
- If subscription sync happens before checkout completion handling,
  subscription data can be stored against the organization billing subject, but
  the org should not become usable until activation service runs.
- If checkout completion arrives before subscription webhook delivery,
  activation retrieves the subscription from Stripe and upserts the local billing
  subscription before marking the organization active.
- If checkout completion runs twice, activation returns the already active org.
- If activation fails due to existing active membership, webhook returns success
  to Stripe only after recording the failure on the checkout intent. Do not let
  Stripe retry forever for a business-state conflict.

Webhook receipt state should continue to represent Stripe delivery processing.
Business-state activation failures live on the checkout intent so they are not
lost when the webhook is acknowledged.

### Invitation Acceptance

Change invitation acceptance service so it:

1. Authenticates user.
2. Loads invite.
3. Verifies invite email matches the authenticated user's verified identity
   policy. Slice 1 should accept the primary verified user email; accepting any
   linked verified identity can be a follow-up if the auth model supports it
   cleanly.
4. Takes the user-scoped membership activation lock.
5. Checks current active membership in `active` or `suspended` organizations.
6. If current org is different from invited org, returns 409 Conflict without
   consuming the invite.
7. If current org is same invited org, returns success idempotently and does not
   downgrade or upgrade role from the invite.
8. If no current org, activates membership in invited org.
9. Queues or reconciles seat count for the org billing subject.
10. Catches the partial-index `IntegrityError` as a final defense, rolls back
   the membership mutation, and maps it to the same 409 response.

Conflict response shape should be explicit enough for UI:

```json
{
  "detail": {
    "code": "already_in_organization",
    "message": "You already belong to a team. Leave your current team before joining this one.",
    "currentOrganization": {
      "id": "...",
      "name": "Existing Team"
    }
  }
}
```

If the server standard requires extra payload fields outside `detail`, use the
existing `ProliferateError` extra-detail convention rather than inventing a new
top-level error shape.

### Membership Updates

Update membership mutation rules:

- Removing a member sets `status = removed`.
- Reactivating a removed member is allowed only if that user has no active
  membership in a different organization.
- Reactivation must take the user-scoped membership activation lock.
- Removing or demoting the last owner remains blocked.
- Owner role/status changes must lock all active owner memberships in the target
  organization, or take an organization-scoped membership lock, before counting
  owners.
- The current user cannot accidentally remove themselves as the last owner.
- Seat adjustment is queued after any change to active membership count.
- Team billing quantity is `max(active_memberships, 1)` for active or pending
  paid subscriptions. Staged invite emails do not count as seats until accepted.

### Shared Sandbox Ensure

Use an activation-safe service helper in the cloud sandbox profile domain, not a
route dependency:

```python
ensure_organization_sandbox_profile_for_activation(
    db,
    organization_id,
    created_by_user_id,
)
```

Call it from Team activation after the organization is active and has an org
billing subject.

Target behavior for slice 1:

- Ensure the organization sandbox profile row.
- Ensure the primary target shell if the existing service can do so without
  requiring route-level admin dependency.
- Do not claim the shared sandbox is fully runtime-ready.
- Do not configure shared auth, BYOK, MCPs, plugins, or LiteLLM providers.

Admin configuration of shared auth, BYOK, MCPs, and LiteLLM providers belongs to
later slices.

### Authorization Checks

Update services that accept an explicit `organization_id` to use status-aware
authorization helpers. The zero-or-one current org invariant is a UI/defaulting
abstraction; it is not an authorization substitute.

Rules:

- Member-facing org pages require active membership in that org.
- Admin org mutations require active owner or admin membership.
- Shared sandbox admin actions require active owner or admin membership in the
  requested org and an `active` organization status.
- Slack, automations, cloud targets, cloud agent auth, billing, and sandbox
  profile routes must verify the exact requested org id.
- Suspended orgs may allow billing repair and member visibility, but block
  launches, shared automations, Slack work, and shared sandbox mutation until
  billing policy says otherwise.
- Read/access helpers must not create billing subjects as a side effect.

### Product-Facing Billing Boundary

Slice 1 should not delete or rename personal billing internals. Existing
`ownerScope = personal` APIs and personal billing subject records may remain
necessary for cloud usage snapshots and free allocation ledgers.

Slice 1 should change product behavior and copy:

- Hosted web and desktop UI must not show "Personal billing."
- Personal checkout, personal customer portal, personal overage settings, and
  refill checkout should be hidden or disabled in product UI unless explicitly
  retained for an existing support path.
- Free user usage should render as "Account credits" or "Included usage."
- Team CTAs should route to the create-team checkout flow, not a generic cloud
  checkout.

## SDK And Client Model Changes

### Organization Client

Keep existing list endpoint support:

```ts
client.organizations.list()
```

Add:

```ts
client.organizations.getCurrentTeam()
client.organizations.listCurrentUserInvites()
client.organizations.acceptInvitation(...)
client.organizations.inviteMember(...)
client.organizations.updateMember(...)
client.organizations.removeMember(...)
client.billing.createTeamCheckout(...)
client.billing.getCurrentTeamCheckout()
client.billing.cancelTeamCheckout(...)
```

If a new endpoint is not added for current org, `getCurrentTeam()` can wrap list
client-side and enforce zero-or-one semantics. The response should preserve
restricted states such as `suspended` instead of mapping them to `null`.

### React Hooks

Add:

```ts
useCurrentTeam()
useCreateTeamCheckoutMutation()
useCurrentTeamCheckout()
useCancelTeamCheckoutMutation()
useCurrentUserOrganizationInvites()
useAcceptOrganizationInviteMutation()
useInviteOrganizationMemberMutation()
useUpdateOrganizationMemberMutation()
useRemoveOrganizationMemberMutation()
```

Deprecate UI use of:

- `activeOrganizationId`
- organization switchers
- arbitrary selected organization lists

Existing list hooks can remain for transitional tests and admin internals, but
new product UI should consume a current-org abstraction.

Application-specific controllers may wrap these hooks for web and desktop, but
the reusable request/response contracts should live in the SDK and SDK React
layer so the two clients do not invent divergent organization behavior.

### Types

Add organization status to SDK types:

```ts
type OrganizationStatus =
  | "pending_checkout"
  | "active"
  | "suspended"
  | "archived";
```

Add a current team result:

```ts
type CurrentTeamResult = {
  organization: Organization | null;
  membership: OrganizationMembership | null;
  restrictedReason?: "suspended" | "billing_required";
};
```

## Frontend UX Changes

### Global UX Rule

There is no organization switcher.

The user either:

- Has no team.
- Is in one team.
- Is resolving an invite or checkout state.

### Web Settings IA

Slice 1 web settings should show or preserve:

- Account
- Organization
- Billing
- Environments
- Support

Route migration:

| Current route/section | Slice 1 target | Notes |
| --- | --- | --- |
| `account` | `account` | No org creation side effects. |
| `teams` | `organization` | Redirect old `teams` deep links to `organization`. |
| `billing` | `billing` | Rename personal surfaces to account credits/included usage. |
| `environments` | `environments` | Existing cloud environment work remains separate. |
| `support` | `support` | Unchanged. |

Shared Sandbox, Agent Auth, Agents, Plugins, Slackbot, and SSH Targets remain
broader settings IA work. Slice 1 can add locked/current-team states only where
those pages already exist in a given client.

### Desktop Settings IA

Desktop settings should show the same organization model, but desktop remains
the owner of local runtime surfaces.

Desktop organization-related pages should not have an active org selector. They
should show the current team or no-team state.

Desktop Stripe return handling should route successful Team checkout returns to
Settings > Organization, not only Settings > Billing. Generic billing returns
can continue using the existing billing route.

### Shared Product UI And Product Model

Because web and desktop need the same Organization/Billing semantics, the slice
should add shared pure view/model pieces rather than duplicating the flow.

Recommended additions:

- `packages/product-model/src/organizations/`
  - current team projection
  - no-team/pending-checkout/active/suspended view-state derivation
  - invite conflict and membership role presentation helpers
  - billing label projection for account credits vs Team billing
- `packages/product-ui/src/organizations/`
  - `OrganizationSettingsView`
  - `CreateTeamDialog`
  - `PendingTeamCheckoutPanel`
  - `TeamMembersTable`
  - `TeamInvitesPanel`
  - `InviteAcceptancePanel`
- `packages/product-ui/src/billing/`
  - `AccountCreditsPanel`
  - `TeamBillingPanel`

Web and desktop own controllers, data hooks, navigation, and platform-specific
checkout opening behavior. Shared components receive already-projected view
models and callbacks.

### Organization Page States

#### No Team

Show:

- Signed-in user identity.
- Clear empty state:
  - "You are not in a team yet."
  - "Create a team to invite people, manage shared work, and use org billing."
- Primary action: "Create team"
- Secondary state for pending invites from
  `client.organizations.listCurrentUserInvites()`, if any.

Do not show:

- Organization selector.
- Empty "active organization" picker.
- Placeholder text implying setup is broken.

#### Pending Checkout

If the user started checkout but has not completed it:

- Show the team name.
- Show "Checkout pending."
- Primary action: "Continue checkout."
- Secondary action: "Cancel setup."
- If expired, show "Checkout expired" and allow starting again.

This is driven by `client.billing.getCurrentTeamCheckout()`. The pending
checkout panel is creator-only and never implies the user is already in an
organization.

#### Active Team

Show:

- Team name.
- Current user's role.
- Members table.
- Invite form.
- Pending invites.
- Billing entry point.
- Shared sandbox status entry point.

Member rows:

- Name/email.
- Role.
- Status.
- Seat billing state if useful.
- Actions based on permission.

#### Suspended Team

Show:

- Team name.
- Billing issue or suspension state.
- Primary action for admins: "Fix billing."
- Read-only member list where appropriate.
- Shared work disabled messaging.

### Billing Page For Slice 1

The full billing cleanup is slice 3, but slice 1 should change language:

- Do not say "personal billing."
- Do not present a product-facing personal billing account.
- Show free user allocations as account credits or included usage.
- Show Team billing only when the user has an active organization and admin
  rights.
- If user has no team, show CTA to create team.
- Product UI can still read personal-owner transport state to render account
  credits, but labels, icons, and actions should not expose it as a billable
  personal account.

Admin with active team:

- Team plan status.
- Seats.
- Usage summary.
- Manage billing portal.

Member without billing permission:

- Team plan summary if allowed.
- "Ask an owner to manage billing."

User with no team:

- Free included usage summary.
- "Create a team" CTA for org billing.

### Invite Acceptance UX

From email link or in-app invite:

1. User opens invite.
2. If signed out, user signs in.
3. If no current team:
   - Show team name.
   - Show inviter.
   - Primary action "Join team."
4. If already in the same team:
   - Show "You are already a member."
   - Link to team settings.
5. If already in another team:
   - Show "You already belong to a team."
   - Explain that Proliferate currently supports one team per account.
   - Provide link to current team settings.
   - Do not offer automatic switching in this slice.

### Create Team UX

Entry points:

- Web Settings > Organization.
- Desktop Settings > Organization.
- Billing page no-team CTA.
- Future onboarding prompt after signup.

Flow:

1. Click "Create team."
2. Dialog/page asks for:
   - Team name.
   - Optional invite emails.
3. User confirms Team plan checkout.
4. App calls create Team checkout endpoint.
5. Browser opens Stripe checkout.
6. After success, app returns to Settings > Organization.
7. App polls or refetches current team and current checkout intent.
8. Active team appears with members and shared sandbox setup status.

### Shared Settings UX Dependencies

Pages that require an organization should become straightforward:

- Shared Sandbox:
  - No team: locked state with "Create a team."
  - Team member: status/read-only as permitted.
  - Team admin: full shared sandbox configuration.
- Slackbot:
  - No team: locked state.
  - Team admin: install/configure Slack.
- Shared Agent Auth:
  - Personal auth page remains personal.
  - Shared auth selection lives under Shared Sandbox or team admin surfaces.
- Automations:
  - Personal automations do not require org.
  - Team automations require current organization.

No page should ask "which org?" in this product model.

Slice 1 locked-state matrix:

| Page | No team | Team member | Team admin/owner |
| --- | --- | --- | --- |
| Organization | Create team / accept invite | View team and members | Manage members/invites |
| Billing | Account credits + create team | Limited Team billing summary | Manage Team billing |
| Shared Sandbox | Locked CTA if page exists | Read status if page exists | Configure if page exists |
| Slackbot | Locked CTA if page exists | Read status if page exists | Configure if page exists |
| Team Automations | Hidden or locked | View allowed team work | Manage allowed team work |

Desktop currently disables some admin-only settings in the sidebar. For slice 1,
Organization and Billing must remain visible because they carry no-team and
billing-repair states. Other team-admin pages may stay disabled with a tooltip
until the broader settings IA pass.

## Migration Plan

### Phase 0: Instrument And Audit

Before changing behavior, add read-only audit queries and logs:

- Count users with zero active org memberships.
- Count users with one active org membership.
- Count users with multiple active org memberships.
- Count organizations with one owner, no subscription, no invites, no shared
  resources, and a default-generated name.
- Count organizations with active billing subscriptions.
- Count organizations with shared sandbox profiles, Slack installs, team
  automations, or shared workspaces.

Do not install the partial unique index until multi-active conflicts are known.

### Phase 1: Schema And Guard Foundation

Changes:

- Add `Organization.status`.
- Backfill existing organizations to `active` initially, except any rows already
  known to be test/archived data.
- Add checkout intent table and indexes.
- Add status-aware current membership/current usable organization helpers.
- Add user-scoped membership activation lock.
- Add organization-scoped owner mutation lock.
- Keep existing organization list response shape.
- Do not yet enable Team checkout or remove default org creation in production.

This phase must land before any code writes `pending_checkout`.

### Phase 2: Compatible Clients

Ship web and desktop clients that handle:

- `GET /v1/organizations` returning `[]`.
- Current team being `null`.
- Current team being `suspended`, if emitted.
- Pending checkout state.
- Current-user pending invites.
- No product-facing personal billing copy.

Keep the old organization list array shape for compatibility. Do not rely on old
clients understanding no-team state until this phase has rolled out.

### Phase 3: Stop New Default Orgs And Enable Team Checkout

Changes:

- Remove auto-ensure from organization listing.
- New users now have no org.
- Enable create-team checkout behind a server feature flag.
- Route all Team CTAs through create-team checkout.
- Update invite acceptance to use the membership activation lock and conflict
  response.

At this point, existing users may still have legacy default orgs.

### Phase 4: Classify Legacy Organizations

Classify organizations into buckets:

1. Real paid team:
   - Has active or trialing Team subscription.
2. Real unpaid legacy team:
   - Has more than one active member, or
   - Has invites, shared sandbox configuration, Slack config, team automations,
     shared workspaces, cloud targets, org repo config, org agent auth, plugin
     or MCP org-owned rows, or workspace exposure/claim records,
   - but has no active Team subscription.
3. Legacy default shell:
   - Single active owner.
   - No active subscription.
   - No invites.
   - No shared team resource evidence in the audited tables.
   - Name matches generated default pattern, or created by old default-org
     helper era.
4. Ambiguous:
   - Does not clearly match either category.

Migration behavior:

- Real paid teams remain active.
- Real unpaid legacy teams become `suspended` unless product explicitly chooses a
  grandfathering rule.
- Legacy default shells are archived and their membership is marked removed.
- Ambiguous organizations are reported for manual review.

Do not delete data in this migration.

Concrete audit checks should include:

- `billing_subscription`
- `sandbox_profile`
- cloud workspace records
- cloud repo configs
- Slack connection/config tables
- automations
- agent auth credential/share tables
- MCP/plugin/skill org-owned rows
- workspace exposure/claim records
- cloud targets
- organization invitations
- active membership count

Default name matching alone is not sufficient to archive anything.

### Phase 5: Resolve Multi-Org Users

For users with multiple active org memberships:

- If only one org is a real team and the rest are legacy default shells, keep the
  real team active and remove/archive the legacy shells.
- If multiple real paid teams remain, do not auto-resolve. Produce a report for
  manual remediation.
- If one real paid team and one or more real unpaid legacy teams remain, keep the
  paid team active and move unpaid legacy teams to removed/suspended according
  to the remediation decision.
- If no real teams and multiple legacy shells, keep none active unless product
  explicitly chooses one. Prefer returning the user to no-team state.

This should happen before the partial unique index is installed.

### Phase 6: Add Database Enforcement

After conflicts are resolved:

- Add partial unique index for active membership per user.
- Add tests proving concurrent invite acceptance cannot create two active
  memberships.

### Phase 7: Remove Multi-Org UX

Once API behavior is stable:

- Remove active org store selection.
- Remove organization selectors.
- Replace organization list UI with current organization UI.
- Replace personal billing copy.
- Update settings routes that currently accept selected org ids where current
  org is sufficient.

## Detailed Implementation Plan

### Server Tasks

1. Add `Organization.status`.
2. Add checkout intent model and migration.
3. Add membership activation lock and owner mutation lock helpers.
4. Add current membership and current usable organization records/helpers.
5. Add pending checkout recovery endpoints.
6. Remove default org creation from list organizations after compatible clients
   ship.
7. Add Team checkout creation service.
8. Add Team activation service with subscription validation.
9. Update Stripe checkout webhook routing and metadata validation.
10. Update invite acceptance conflict logic.
11. Update membership reactivation logic.
12. Add partial unique index after cleanup migration.
13. Ensure shared sandbox profile and primary target shell on activation.
14. Add audit scripts or admin-only diagnostics for legacy org classification.

### SDK Tasks

1. Regenerate organization types for status.
2. Add create/get/cancel Team checkout client methods.
3. Add current team helper.
4. Add current-user pending invites client method.
5. Add organization member/invite mutations needed by shared UI.
6. Add React mutation/query hooks for the above.
7. Deprecate active org list selection patterns in app code.

### Web Tasks

1. Update Settings > Organization to current-org model.
2. Add no-team create flow.
3. Add pending checkout recovery state.
4. Add current-user pending invite states.
5. Add invite acceptance states.
6. Update Billing page copy to org billing plus free allocations.
7. Redirect old Teams settings route/section to Organization.
8. Route shared/team settings through current org where those pages already
   exist.
9. Add locked states for team-only pages that remain visible.

### Desktop Tasks

1. Update organization store to remove active org selection.
2. Update `use-active-organization` to current-org semantics or replace it.
3. Update Organization pane.
4. Add pending checkout recovery state.
5. Update Billing pane language.
6. Route Team checkout returns to Organization settings.
7. Update Slackbot and shared settings panes to current-org model.
8. Keep desktop local-runtime settings separate from org settings.

### Product Copy Tasks

Use consistent language:

- "Team" in user-facing headings where possible.
- "Organization" where it refers to admin or legal/billing entities.
- "Free credits" or "included usage" for free user allocations.
- "Team billing" for paid plan billing.
- Never "personal billing" in product copy.

## Edge Cases

### User Starts Checkout Twice

If a user has an existing pending checkout intent:

- Return it from `GET /v1/billing/team-checkout/current` if still valid.
- Let the user continue checkout with the existing URL if Stripe still allows
  it.
- Let the user cancel it, which archives the pending organization shell.
- Expire it server-side and allow a new checkout if Stripe session expiration has
  passed.

Do not create multiple active organizations.

### User Starts Checkout, Then Accepts Invite

If a user accepts an invite before checkout completes:

- Invite acceptance can succeed if no active org exists.
- Later checkout activation must detect the user now belongs to a different org
  and fail safely.
- The pending checkout organization remains inactive and should be cancellable
  or support-resolvable.

### User Accepts Two Invites At Once

Both requests race.

- Service takes the user-scoped membership activation lock.
- Service checks current org while holding the lock.
- Database partial unique index allows only one active membership after Phase 6.
- Losing request returns conflict or maps integrity error to conflict.

### Subscription Created But Webhook Ordering Differs

Stripe may deliver subscription and checkout webhooks in different order.

- Subscription sync can update billing records.
- Organization usability is controlled by checkout intent activation.
- Activation retrieves/upserts the subscription from Stripe if local subscription
  state is not present yet.
- Activation is idempotent and can observe already-synced subscription fields.

### Existing User With Legacy Default Org

After migration cleanup, if their default org had no real team state:

- They see no-team state.
- They keep their user account and free allocations.
- They can create or join a team.

### Existing User With Real Team

After migration:

- They see exactly that team.
- They lose no team resources.
- Team billing and seats are preserved.

### Suspended Team

Suspension should not remove memberships. It changes what actions are allowed.
Users still see the team, but shared launches and admin mutation can be blocked
according to billing policy.

## Test Plan

### Server Unit Tests

- `list_organizations` returns `[]` for a user with no membership.
- `list_organizations` does not create an organization.
- Current membership helper returns `None` for no membership.
- Current membership helper returns suspended org membership as current for
  conflict checks.
- Current usable organization helper returns active org for one active
  membership.
- Current helpers error before migration if multiple active memberships are
  detected.
- Invite accept succeeds for user with no org.
- Invite accept is idempotent for user already in same org.
- Invite accept returns 409 for user in different org.
- Invite accept does not consume the invite when returning already-in-org
  conflict.
- Two concurrent invite accepts serialize through the membership activation
  lock.
- Reactivating a removed member fails if user belongs to another org.
- Removing or demoting last owner fails under concurrent owner mutations.
- Seat adjustment is queued after membership activation/removal.
- Team checkout creation fails if user already has an active org.
- Team checkout creation creates pending org, billing subject, and intent.
- Team checkout creation reuses or returns existing non-terminal intent.
- Team checkout cancel archives pending org.
- Team activation creates owner membership and marks org active.
- Team activation validates Team price and active/trialing subscription before
  marking org active.
- Team activation ensures shared sandbox profile and primary target shell.
- Team activation is idempotent under repeated webhook calls.
- Team activation fails safely if creator joined another org meanwhile.

### Database Tests

- Partial unique index prevents two active memberships for one user.
- Removed memberships do not violate the partial unique index.
- A user can have removed memberships in multiple organizations.
- Migration backfills organization status.
- Legacy shell classification does not archive real teams.
- Legacy unpaid teams are classified separately from real paid teams.

### Stripe/Webhook Tests

- `checkout.session.completed` with Team metadata activates org.
- Team checkout metadata is validated on both Checkout Session and Subscription.
- Repeated checkout webhook is idempotent.
- Subscription sync before activation does not make org usable by itself.
- Checkout completion before subscription webhook retrieves/upserts subscription
  before activation.
- Business-state activation failure is recorded without infinite Stripe retry.

### SDK Tests

- Organization status is parsed.
- `getCurrentTeam()` maps empty list to null.
- `getCurrentTeam()` maps one item to organization and membership.
- Create Team checkout client sends expected payload.
- Current Team checkout hooks expose pending, expired, cancelled, and failed
  states.
- React current team hook exposes loading, null, active, and restricted states.

### Web Tests

- Settings has Organization page no-team state.
- No-team state has Create team action.
- No-team state renders current-user pending invites.
- Pending checkout state renders Continue checkout and Cancel setup.
- Team checkout action calls create checkout mutation.
- Active team state renders members and invites.
- Existing Teams list is gone.
- Invite conflict state renders if user already belongs to a team.
- Billing page does not render "personal billing."
- Billing page shows free included usage or credits.

### Desktop Tests

- Organization pane no longer renders active organization selector.
- No-team state renders correctly.
- Pending checkout state renders correctly.
- Active team renders members/invites.
- Billing pane does not render "personal billing."
- Slackbot pane uses current organization and locked no-team state.
- Active org store selection is removed or unused by org settings.

### Manual Smoke

1. New web user signs in.
2. Settings > Organization shows no-team state.
3. Settings > Billing shows free included usage and create-team CTA.
4. Create team starts Stripe checkout.
5. Completing checkout returns to active Team state.
6. Shared Sandbox page shows created team sandbox profile/setup status.
7. Invite another user.
8. Invited user with no team accepts and joins.
9. Invited user already in another team gets conflict.
10. Desktop settings show the same current team and no org selector.

## Rollout Plan

### Development

1. Land server schema foundation: organization status, checkout intent table,
   membership locks, current-team helpers.
2. Add migration audit command.
3. Add frontend current-team/no-team handling in web and desktop.
4. Add pending checkout and current-user invite APIs/hooks.
5. Add Team checkout endpoint and webhook activation behind a feature flag.
6. Run local/dev migration classification.

### Staging

1. Run audit in staging.
2. Review multi-org users and legacy shell classification.
3. Exercise Stripe test checkout.
4. Verify invite conflict behavior.
5. Verify shared sandbox profile and primary target shell creation.
6. Verify old clients still tolerate organization list shape.

### Production

1. Deploy audit-only code.
2. Review production reports.
3. Deploy compatible clients that handle no-team and remove product-facing
   personal billing copy.
4. Deploy schema foundation and membership locks.
5. Resolve ambiguous multi-org cases manually.
6. Enable no-auto-create and new create-team flow behind a feature flag.
7. Run legacy shell archive/suspension migration.
8. Add partial unique index.
9. Remove remaining multi-org UI and selectors.

## Open Questions

1. Should Team checkout live under `/v1/billing/team-checkout` or
   `/v1/organizations/team-checkout`?

   Recommendation: billing endpoint owns Stripe checkout. Organization service
   owns activation side effects.

2. Should pending checkout organizations be visible anywhere?

   Recommendation: not in organization list. Expose pending checkout intent only
   to the creator through Team checkout recovery endpoints.

3. Should a user be able to leave a team themselves?

   Recommendation: yes for non-last-owner members, but this can be a follow-up
   if owner/admin removal already exists.

4. Should a user be able to transfer directly from one team to another?

   Recommendation: not in this slice. Make them leave or be removed first.

5. What happens to default orgs with local-only user history?

   Recommendation: archive only when no real team-owned resources exist. Keep
   all local/user work untouched.

6. Should free user allocations continue to use billing subjects internally?

   Recommendation: allow temporarily, but rename API/product concepts now and
   move internals in the full billing cleanup slice.

7. Should unpaid legacy teams be grandfathered or suspended?

   Recommendation: classify them separately in the migration. Default to
   `suspended`/billing-repair unless product explicitly chooses grandfathering.

8. Should Stripe redirect URLs be client-supplied?

   Recommendation: no. Use server-owned/allowlisted success and cancel URLs with
   a small client context enum if needed.

## Success Criteria

This slice is complete when:

- New users have no organization by default.
- Users can have zero or one active organization.
- Suspended teams still count as current membership for join/create conflict
  checks.
- The database enforces one active organization membership per user.
- Team subscription checkout creates and activates organizations.
- Team activation validates Stripe subscription state and records durable
  activation failures.
- Pending checkout can be resumed or cancelled by the creator.
- Invite acceptance cannot put a user in a second active organization.
- Shared sandbox profile and primary target shell are created for new active
  teams, without claiming full shared runtime readiness.
- Web and desktop settings no longer show organization switchers.
- Product copy no longer exposes personal billing.
- Tests cover no-auto-create, one-org invariant, invite conflicts, checkout
  recovery, Team activation, webhook ordering, and shared sandbox initialization.
