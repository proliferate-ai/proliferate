# Organization Invitations

Date: 2026-06-24.

Last reconciled: 2026-07-17.

Scope:

- `server/proliferate/db/models/organizations.py`
- `server/proliferate/db/store/organization_invitations.py`
- `server/proliferate/server/organizations/**`
- `cloud/sdk/src/client/organizations.ts`
- `apps/web/src/browser/links/OrganizationJoinRoute.tsx`
- `apps/packages/product-client/src/hooks/organizations/lifecycle/use-organization-join-auth-launch.ts`
- `apps/packages/product-client/src/hooks/organizations/workflows/use-organization-join-invitation-flow.ts`
- `apps/packages/product-client/src/components/settings/panes/AccountPane.tsx`
- `apps/packages/product-client/src/components/settings/panes/OrganizationMembersPane.tsx`
- `apps/packages/product-client/src/components/app/sidebar/SidebarAccountFooter.tsx`
- `apps/packages/product-client/src/lib/domain/auth/desktop-navigation.ts`

## Model

Organization access is granted by durable server-side policy, not by possession
of a secret URL.

`OrganizationInvitation` is the email-specific pending grant:

- `organization_id`
- normalized invited `email`
- invited `role`
- `status` (`pending`, `accepted`, `revoked`, `expired`)
- delivery metadata (`pending`, `sent`, `failed`, `skipped`)
- inviter, accepted user, and lifecycle timestamps

The canonical link for an organization invitation is:

```text
/join/{organizationId}
```

The same link is sent in email and copied from admin UI. It can be forwarded or
shared, but it does not prove access by itself. When a signed-in user accepts,
the server checks whether their authenticated email has a pending invitation for
that organization. Future join policies may also allow verified-domain joins or
organization-wide invite links, but those policies must still be evaluated on
the server at accept time.

## Join Flow

The browser URL is the universal entrypoint:

```text
Email / copied link -> https://.../join/{organizationId}
```

The narrow Web host route first discovers and starts SSO by organization id.
When that succeeds, the browser redirects to the provider; JIT membership or
invitation acceptance remains a server callback decision. Any discovery or
start failure falls back to opening Desktop with:

```text
proliferate://join/{organizationId}
```

The current route renders only an announced progress message and assigns the
deep link (`proliferate-local://` on loopback); it does not render product UI or
a retry/install surface. Hosted web product sessions remain beta-gated, and the
host route does not require web product authentication before attempting SSO or
the Desktop handoff.

ProductClient's shared Desktop navigation maps the deep link to the non-admin
Account surface:

```text
/settings?section=account&joinOrganizationId={organizationId}
```

Before the authenticated tree mounts, ProductClient persists the organization
target and attempts organization SSO. For the known not-configured/not-available
SSO outcomes it falls back to standard GitHub sign-in; other errors remain
visible for retry rather than silently changing methods. On successful
organization SSO, server user resolution may accept a matching pending
invitation and create the active membership during the callback; that path does
not wait for an `AccountPane` action. If the invitation remains pending, as in a
standard GitHub fallback, the shared workflow resumes the persisted target after
authentication, handles explicit cross-server trust when needed, and navigates
to Account. `AccountPane` then shows the matching pending invitation and requires
explicit acceptance. That ProductClient acceptance activates the joined
organization, clears the target, and refreshes invitation and membership state.

## Permissions

All server-side invitation management endpoints — create, resend, revoke, and
list (`GET /organizations/{organization_id}/invitations`) — require the caller
to hold the `admin` or `owner` role on the target organization
(`current_path_org_admin`). Plain members can see the organization's active
memberships (`/members`) but not pending invitation emails or roles. This
mirrors the shared ProductClient UI, which treats the whole
`organization-members` section as admin-only (see `settings-admin-ia.md`) while
placing an invitee's own acceptance on the non-admin Account surface.

## Admin UX

Organization settings is split into:

- `organization`: organization profile, logo, billing, and team setup
- `organization-members`: active members, pending invitations, and invite tools

The Members page combines active memberships and pending invitations in one
people-oriented list. Rows show:

- avatar or initials
- name/email
- joined date, or `Invited`
- role
- auth method summary when known
- an action menu for rescind invitation, change role, or remove member

Admins can invite by email. Creating an email invitation records a pending
`OrganizationInvitation` and sends the canonical `/join/{organizationId}` link
when email delivery is configured. If delivery is not configured, the invitation
remains pending and delivery status is `skipped`.

Admins can also copy the invite link. The copied URL is exactly the same URL
that email delivery sends.

## Global Pending Invites

Pending invitations for the signed-in email should be visible from the
persistent app sidebar footer, including while Settings is open. This keeps
acceptance discoverable without burying it inside the Organization settings
page.

## Acceptance Rules

Accepting an organization invitation must:

- require a signed-in product user
- normalize the signed-in email before matching
- accept only pending, unexpired invitations for the target organization
- reject email mismatches with a stable forbidden error
- allow users to belong to more than one organization
- be idempotent for a user already active in the target organization
- mark the invitation accepted and create/reinstate the active membership in the
  invited role
- trigger seat reconciliation for the accepted membership

## Out Of Scope

- Web invite acceptance for organizations without usable SSO
- Self-serve organization-wide invite-link policy storage
- Enterprise verified-domain join policy storage
- Public password signup or password reset
