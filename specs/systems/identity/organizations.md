# Organizations

Status: current (grade B). System spec in the Organization Standard anatomy. [`invitations.md`](invitations.md) is this system's invitation section (join link, desktop join flow, admin UX).

## 1. Purpose

Organizations own the tenant: the organization row, membership and roles, invitations, the single-org-mode instance organization and its admin floor, self-registration by invitation, team-checkout intents, and the org-admin usage/limits surface. An organization is the only billing subject at the product layer (every account gets a default org). Organizations do not authenticate anyone and do not compute money.

## 2. Owned state

[`db/models/organizations.py`](../../../server/proliferate/db/models/organizations.py):

| Table | Meaning |
| --- | --- |
| `organization` | name, nullable unique `slug`, logo, `status ∈ {pending_checkout, active, suspended, archived}`, `is_instance` (partial-unique: at most one). |
| `organization_membership` | `(organization, user)` unique; `role ∈ {owner, admin, member}`; `status ∈ {active, removed}`. |
| `organization_invitation` | email-specific pending grant; `status ∈ {pending, accepted, revoked, expired}`; delivery status; one pending row per (org, email). |
| `organization_checkout_intent` | team-checkout intent: status, activation status, Stripe ids, idempotency key, staged invite emails, 24h expiry; one pending per creator. |

`billing_budget_limit` is billing's table; organizations own the admin *routes* that replace it (see Fences).

## 3. Public surface

```text
GET  /v1/organizations                                   list (mints the default org in hosted mode)
GET  /v1/organizations/{id} · PATCH /v1/organizations/{id}
GET  /v1/organizations/{id}/members · PATCH|DELETE .../members/{membership_id}
GET  /v1/organizations/{id}/invitations · POST .../invitations · POST .../invitations/{id}/resend · DELETE .../invitations/{id}
GET  /v1/organizations/{id}/join-link
POST /v1/organizations/invitations/accept · GET /v1/organizations/invitations/current · POST /v1/organizations/invitations/current/{invitation_id}/accept
GET  /v1/organizations/{id}/usage/by-user · GET .../usage/users/{user_id}/timeseries
GET  /v1/organizations/{id}/limits · PUT .../limits           full replacement
GET  /join/{organizationId}                              landing page (HTML)
POST /auth/password/register · GET|POST /register        single-org self-registration (mounted only in single-org mode)
```

Python surface (MANIFEST): `proliferate.server.organizations.api`, `.service`, `.models`. Named seams other systems call: `service.resolve_owner_context` (used by `permissions.py`), `membership_policy.place_new_identity`, `admin_emails.ensure_admin_email_role` / `is_admin_listed_email`, `registration.ensure_default_organization_for_account`, `membership_policy.claim_instance_organization` (used by `setup`).

SDK: [`cloud/sdk/src/client/organizations.ts`](../../../cloud/sdk/src/client/organizations.ts), [`cloud/sdk-react/src/hooks/organizations.ts`](../../../cloud/sdk-react/src/hooks/organizations.ts).

## 4. Consumes

- `billing`: `ensure_{personal,organization}_billing_subject_state` (payer
  resolution inside `resolve_owner_context`),
  `maybe_create_organization_seat_adjustment` on membership changes and
  invitation accepts, store reads for the usage/limits admin routes.
- `agent_auth`: `schedule_agent_gateway_org_enrollment` on accept.
- `setup`: account-creation machinery reused by self-registration.
- Capability `email` (invitation delivery, durable with `delivery_status`).
- Config: `single_org_mode`, `admin_emails`, `allowed_email_domains`,
  `password_auth_enabled`, `web_app_base_url`, `api_base_url`,
  `ORGANIZATION_INVITE_EXPIRES_DAYS`
  ([`constants/organizations.py`](../../../server/proliferate/constants/organizations.py)).

## 5. Laws

- **Placement is one seam.** Every account-creation path calls
  `place_new_identity`; hosted mode mints a personal default org (owner);
  single-org mode joins the instance org or fails closed (503 before the
  first-run claim; 403 for a membership an admin removed) — never a personal
  org, never silent reactivation, except the ADMIN_EMAILS lockout-recovery
  path.
- **ADMIN_EMAILS is a floor, not a ceiling**, asserted at creation and every
  login, inert in hosted mode; the instance org always keeps ≥1 active admin
  (serialized by an advisory lock so two demotions cannot race to zero); a
  listed email cannot be demoted below admin.
- **Role changes are endpoint-authorized**: admin/owner manage members;
  only owners modify owners; nobody modifies their own membership; the last
  owner cannot be removed or downgraded (store-level verdict).
- **Access is durable policy, not a secret URL.** `/join/{organizationId}`
  proves nothing; acceptance checks a pending, unexpired invitation for the
  authenticated (normalized) email; mismatches are a stable 403; users may
  belong to many orgs; accept is idempotent for an already-active member and
  reinstates a removed one in the invited role.
- **Invitation as allowlist (single-org).** A live pending invitation IS the
  allowlist entry; registration requires the invitation token, is looked up
  by token never by email, and every bad token gets one uniform 403 (no
  enumeration); `ALLOWED_EMAIL_DOMAINS` is a gate, never a grant.
- **Durability boundaries.** Invited-registration and revocation commit
  before the response; an immediate login/list/accept observes the new state.
- **Team checkout** stages one pending intent per creator under the
  membership-activation lock; activation is billing's webhook decision and
  organizations only records the outcome and sends the staged invites.
- **Slugs** are human handles, nullable so races never block a write, unique
  among live values.

## 6. Emits

- Seat adjustments (to billing) on membership status change and accept.
- Agent-gateway org enrollment (to `agent_auth`) on accept.
- Invitation emails with `delivery_status` receipts.
- `OwnerContext` — the resolved payer/standing consumed by every owner-scoped
  route through `permissions.py`.

## 7. Fences

- **`accounts`** own the user, sign-in and tokens; organizations never read
  credentials.
- **`billing`** owns money: subjects, seats math, limits *table*, checkout
  activation logic. Organizations expose the org-admin usage/limits routes as
  a thin adapter over billing's stores.
- **`setup`** owns the first-run claim page; organizations own the one
  function that may create the instance org.
- **`permissions.py`** owns request-time standing resolution; the service
  layer's remaining inline `_require_current_org_role` checks are migration
  debt (see [`specs/systems/identity/auth-surface.md`](auth-surface.md)).
- **Settings surface** owns navigation; `OrganizationMembersPane`,
  `SidebarAccountFooter` pending-invite affordance and the join page are this
  system's presentation.

## 8. Code map

```text
server/proliferate/server/organizations/**       MANIFEST.toml → this spec
  api.py · models.py · errors.py · service.py
  membership_policy.py · admin_emails.py · registration.py · self_registration.py · registration_api.py · registration_pages.py
  join_links.py · join_api.py · landing.py · invitation_delivery.py
  usage/{api,service,models,transactions}.py    org-admin usage + limits adapter
  domain/{policy,profile}.py                    pure rules
server/proliferate/db/models/organizations.py
server/proliferate/db/store/{organizations,organization_records,organization_invitations,organization_member_auth_methods,instance_organizations}.py
server/proliferate/constants/organizations.py
cloud/sdk/src/client/organizations.ts · cloud/sdk-react/src/hooks/organizations.ts
apps/packages/product-client/src/components/settings/panes/OrganizationMembersPane.tsx
apps/packages/product-client/src/components/app/sidebar/SidebarAccountFooter.tsx
```

## 9. Proof

- `integration/test_organizations_api.py`, `integration/test_organization_lookup_api.py`,
  `integration/test_organization_slug_allocation.py`,
  `integration/test_organization_usage_api.py`.
- `unit/test_membership_policy.py`, `unit/test_membership_policy_roles.py`,
  `unit/test_organization_domain.py`, `unit/test_organization_errors.py`,
  `unit/test_organization_invitation_service.py`,
  `unit/test_organization_join_landing.py`, `unit/test_organization_slugs.py`,
  `unit/test_organization_team_checkout_service.py`,
  `unit/test_organization_team_checkout_activation_service.py`,
  `unit/test_team_checkout_invitation_delivery.py`.
- Self-host lanes: `tests/release` T2-AUTH / T4-SH scenarios (single-org
  claim, invite-as-allowlist).

## Known gaps / follow-ups

- **Service subjects (※ new).** Core Architecture adds a third subject kind —
  a non-human principal an org owns, under which headless runs, Slack-triggered
  work and API tokens execute. Nothing exists today; the closest primitive is
  the instance org's owner.
  > [!decision] PABLO DECIDES: model a service subject as (a) a `user` row
  > flagged `kind = service` with a membership (smallest change; reuses every
  > role check and token path) or (b) a new `organization_service_subject`
  > table with its own token issuer in `api`. Recommendation: (a) — the
  > membership/role machinery is exactly what agents-as-clients need, and
  > `accounts` already has the generation-revocation primitive.
- The web `OrganizationJoinPage` named in `invitations.md` no longer exists
  on `main` (web is gated off); the join deep link is desktop-only until web
  reintegration.
- Inline role checks in `service.py` predate the endpoint-composed pattern.
