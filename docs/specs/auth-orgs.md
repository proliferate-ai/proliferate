# Auth, Orgs & Onboarding — System Spec

## 1. Scope & Purpose

### In Scope
- User authentication via better-auth (email/password + GitHub/Google OAuth)
- Email verification flow (conditional, Resend-based)
- Auth provider metadata (`google`/`github`/`email`) for web login UI
- Gateway WebSocket token issuance via authenticated oRPC procedure
- Organization model: personal orgs, team orgs, slug-based identity
- Member management: roles (owner/admin/member), role changes, removal
- Invitation system: create, email delivery, accept/reject, expiry
- Domain suggestions: email-domain-based org matching for auto-join
- Onboarding flow: status checks, trial activation, finalization
- Trial activation trigger (credit provisioning handoff to billing)
- API keys: creation via CLI device auth, verification for Bearer auth
- Admin: super-admin detection, user/org listing, impersonation, org switching
- Auth middleware chain: session resolution, API key fallback, impersonation overlay

### Out of Scope
- Trial credit amounts and billing policy (shadow balance, metering, gating) — see `billing-metering.md`
- Gateway auth middleware for WebSocket/HTTP streaming — see `sessions-gateway.md` §7
- CLI device auth flow (device code create/authorize/poll) — see `cli.md` §6
- Integration OAuth for GitHub/Sentry/Linear/Slack via Nango — see `integrations.md`

### Mental Model

Authentication and organization management form the identity layer of Proliferate. A personal organization is created for each user at signup (best-effort — see §9). Users can also create team organizations or be invited to existing ones. All resource-scoped operations (sessions, repos, secrets, automations) are bound to an organization via `activeOrganizationId` on the auth session.

The system uses better-auth as the authentication framework, with two plugins: `organization` (multi-tenant org management, invitations) and `apiKey` (CLI token authentication). Auth state flows through three possible paths: cookie-based sessions, API key Bearer tokens, or a dev-mode bypass.

Super-admins can impersonate any user via a cookie-based overlay that transparently replaces the effective user/org context without modifying the actual session.

**Core entities:**
- **User** — authenticated identity with email, name, and optional OAuth accounts
- **Organization** — tenant boundary for all resources; either personal (auto-created) or team
- **Member** — join record linking a user to an org with a role (owner/admin/member)
- **Invitation** — pending invite with email, role, expiry, and accept/reject lifecycle
- **Auth session** — better-auth session with `activeOrganizationId` for org scoping
- **API key** — long-lived Bearer token for CLI authentication

**Intended invariants (best-effort, not guaranteed):**
- Every user should have a personal organization — created in a `user.create.after` database hook, but uses `ON CONFLICT (slug) DO NOTHING` so it silently fails if the generated slug collides (see §9)
- Auth sessions should have `activeOrganizationId` set — populated in a `session.create.before` hook from the user's first membership, but returns the session unchanged if the user has no memberships
- Only owners can modify member roles or remove members — enforced by better-auth's organization plugin endpoints
- Owner role cannot be changed or removed through better-auth's member management endpoints
- Domain update logic exists in the service layer with owner-only checks, but is not wired to any route (see §9)
- Impersonation requires super-admin status (email in `SUPER_ADMIN_EMAILS` env var)

---

## 2. Core Concepts

### better-auth
better-auth is the authentication framework providing email/password and OAuth login, session management, and plugin-based extensions. Proliferate uses two plugins: `organization` for multi-tenancy and `apiKey` for CLI tokens.
- Key detail agents get wrong: better-auth manages the `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, and `apikey` tables directly. Do not modify these schemas outside of better-auth's migration flow.
- Reference: `apps/web/src/lib/auth.ts`

### Organization Plugin
The better-auth organization plugin registers server-side API routes under `/api/auth/organization/*` for org CRUD, membership, invitation lifecycle, and org switching. These are first-class backend endpoints — auto-registered by the plugin at server startup, not frontend-only logic. Proliferate layers custom read-only logic (domain suggestions, onboarding status, billing fields) on top via oRPC.
- Key detail agents get wrong: Org/member/invitation _writes_ are handled by better-auth's plugin endpoints, invoked from the frontend via the client SDK (`organization.create()`, `organization.setActive()`, `organization.updateMemberRole()`, `organization.removeMember()`, `organization.inviteMember()`, `organization.acceptInvitation()`). The custom oRPC routes only _read_ (list orgs, list members, list invitations, get domain suggestions).
- Reference: `apps/web/src/lib/auth.ts:organization()`

### Impersonation
A cookie-based overlay that lets super-admins act as another user. The `requireAuth()` helper checks for the impersonation cookie and swaps the effective user/org context transparently.
- Key detail agents get wrong: Impersonation does not create a new session. It overlays the existing super-admin session with different effective user/org IDs. The `impersonation` context field tracks the real admin's identity for audit.
- Reference: `apps/web/src/lib/auth-helpers.ts:requireAuth`, `apps/web/src/lib/super-admin.ts`

---

## 3. File Tree

```
apps/web/src/lib/
├── auth.ts                          # better-auth instance + config
├── auth-helpers.ts                  # getSession, requireAuth, API key resolution
├── super-admin.ts                   # isSuperAdmin, impersonation cookie helpers
├── billing.ts                       # isBillingEnabled (used by onboarding)

apps/web/src/server/routers/
├── middleware.ts                    # protectedProcedure, orgProcedure
├── auth.ts                          # Auth provider metadata + ws token issuance
├── orgs.ts                         # Org list/get, members, invitations, domains
├── onboarding.ts                   # Status, startTrial, markComplete, finalize
├── admin.ts                        # Super-admin status, listing, impersonation

packages/services/src/orgs/
├── index.ts                        # Re-exports
├── db.ts                           # Drizzle queries for org/member/invitation
├── service.ts                      # Business logic orchestration
├── mapper.ts                       # DB row → API type transformations

packages/services/src/onboarding/
├── index.ts                        # Re-exports
├── db.ts                           # Onboarding-specific queries
├── service.ts                      # Status computation, repo upsert

packages/services/src/admin/
├── index.ts                        # Re-exports
├── db.ts                           # Admin queries (all users/orgs)
├── service.ts                      # Impersonation validation
├── mapper.ts                       # DB row → admin API types

packages/services/src/users/
├── index.ts                        # Re-exports
├── db.ts                           # User lookup (findById)

packages/db/src/schema/
├── auth.ts                         # user, session, account, verification,
│                                   # organization, member, invitation, apikey tables

packages/shared/src/
├── auth.ts                         # JWT helpers (verifyToken, signServiceToken)
├── contracts/orgs.ts               # Zod schemas + ts-rest contract
├── contracts/admin.ts              # Admin schemas + contract
├── contracts/onboarding.ts         # Onboarding schemas + contract

apps/web/src/app/invite/[id]/
├── page.tsx                        # Invitation acceptance UI
```

---

## 4. Data Models & Schemas

### Database Tables

```
user
├── id              TEXT PRIMARY KEY
├── name            TEXT NOT NULL
├── email           TEXT NOT NULL UNIQUE
├── emailVerified   BOOLEAN NOT NULL
├── image           TEXT
├── createdAt       TIMESTAMPTZ
└── updatedAt       TIMESTAMPTZ
```

```
session (auth sessions, not app sessions)
├── id                      TEXT PRIMARY KEY
├── token                   TEXT NOT NULL UNIQUE
├── expiresAt               TIMESTAMPTZ NOT NULL
├── userId                  TEXT FK → user.id (CASCADE)
├── activeOrganizationId    TEXT           -- set by session-create hook
├── ipAddress               TEXT
├── userAgent               TEXT
├── createdAt               TIMESTAMPTZ
└── updatedAt               TIMESTAMPTZ
    IDX: session_userId_idx(userId)
```

```
account
├── id                      TEXT PRIMARY KEY
├── accountId               TEXT NOT NULL   -- provider's user ID
├── providerId              TEXT NOT NULL   -- "credential", "github", "google"
├── userId                  TEXT FK → user.id (CASCADE)
├── accessToken             TEXT
├── refreshToken            TEXT
├── password                TEXT           -- hashed, credential accounts only
├── createdAt               TIMESTAMPTZ
└── updatedAt               TIMESTAMPTZ
    IDX: account_userId_idx(userId)
```

```
organization
├── id                      TEXT PRIMARY KEY
├── name                    TEXT NOT NULL
├── slug                    TEXT NOT NULL UNIQUE
├── logo                    TEXT
├── metadata                TEXT
├── createdAt               TIMESTAMPTZ NOT NULL
├── allowedDomains          TEXT[]         -- domains for auto-join suggestions
├── isPersonal              BOOLEAN        -- true for auto-created personal orgs
├── autumnCustomerId        TEXT           -- Autumn billing customer ID
├── billingSettings         TEXT           -- JSON-encoded OrgBillingSettings
├── onboardingComplete      BOOLEAN        -- onboarding finalization flag
├── billingState            TEXT NOT NULL DEFAULT 'unconfigured'
├── billingPlan             TEXT           -- "dev" or "pro"
├── shadowBalance           NUMERIC(12,6)  -- fast-path credit balance
├── shadowBalanceUpdatedAt  TIMESTAMPTZ
├── graceEnteredAt          TIMESTAMPTZ
└── graceExpiresAt          TIMESTAMPTZ
    UIDX: organization_slug_uidx(slug)
```

```
member
├── id              TEXT PRIMARY KEY
├── organizationId  TEXT FK → organization.id (CASCADE)
├── userId          TEXT FK → user.id (CASCADE)
├── role            TEXT NOT NULL   -- "owner" | "admin" | "member"
└── createdAt       TIMESTAMPTZ NOT NULL
    IDX: member_organizationId_idx, member_userId_idx
```

```
invitation
├── id              TEXT PRIMARY KEY
├── organizationId  TEXT FK → organization.id (CASCADE)
├── email           TEXT NOT NULL
├── role            TEXT           -- assigned role on acceptance
├── status          TEXT NOT NULL  -- "pending" | "accepted" | "rejected" | "canceled"
├── expiresAt       TIMESTAMPTZ NOT NULL
├── inviterId       TEXT FK → user.id (CASCADE)
└── createdAt       TIMESTAMPTZ
    IDX: invitation_organizationId_idx, invitation_email_idx
```

```
verification
├── id              TEXT PRIMARY KEY
├── identifier      TEXT NOT NULL   -- email address
├── value           TEXT NOT NULL   -- verification token
├── expiresAt       TIMESTAMPTZ NOT NULL
├── createdAt       TIMESTAMPTZ
└── updatedAt       TIMESTAMPTZ
    IDX: verification_identifier_idx
```

```
apikey
├── id              TEXT PRIMARY KEY
├── name            TEXT           -- e.g., "cli-token"
├── key             TEXT NOT NULL  -- hashed key value
├── start           TEXT           -- key prefix for display
├── prefix          TEXT
├── userId          TEXT FK → user.id (CASCADE)
├── enabled         BOOLEAN
├── expiresAt       TIMESTAMPTZ
├── requestCount    INTEGER
├── remaining       INTEGER
├── createdAt       TIMESTAMPTZ NOT NULL
└── updatedAt       TIMESTAMPTZ NOT NULL
    IDX: apikey_key_idx, apikey_userId_idx
```

All tables defined in `packages/db/src/schema/auth.ts`.

### Key Indexes & Query Patterns
- User lookup by email: `user.email` unique index — used by better-auth for login
- Session lookup by token: `session.token` unique index — used by `auth.api.getSession()`
- Member by org: `member_organizationId_idx` — list members, check membership
- Member by user: `member_userId_idx` — list user's orgs, resolve `activeOrganizationId`
- Invitation by org: `invitation_organizationId_idx` — list pending invitations
- API key by key hash: `apikey_key_idx` — verify Bearer tokens
- Domain suggestions: `organization.allowedDomains @> ARRAY[domain]::text[]` — sequential scan (no GIN index)

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/orgs.ts
type OrgRole = "owner" | "admin" | "member";

interface Organization {
  id: string; name: string; slug: string; logo: string | null;
  is_personal: boolean | null; allowed_domains: string[] | null; createdAt: string;
}

interface Member {
  id: string; userId: string; role: OrgRole; createdAt: string;
  user: { id: string; name: string | null; email: string; image: string | null } | null;
}

interface Invitation {
  id: string; email: string; role: OrgRole; status: string;
  expiresAt: string; createdAt: string;
  inviter: { name: string | null; email: string } | null;
}

// packages/shared/src/contracts/onboarding.ts
interface OnboardingStatus {
  hasOrg: boolean; hasSlackConnection: boolean; hasGitHubConnection: boolean;
  repos: Array<{ id: string; github_repo_name: string; prebuild_status: "ready" | "pending" }>;
}

// packages/shared/src/auth.ts
interface TokenPayload extends JWTPayload {
  sub: string; email?: string; orgId?: string; role?: string; service?: boolean;
}
```

---

## 5. Conventions & Patterns

### Do
- Use `protectedProcedure` for routes needing any authenticated user — `apps/web/src/server/routers/middleware.ts`
- Use `orgProcedure` for routes needing an active organization context — same file
- Check membership in the service layer before returning data (return `null` → router converts to FORBIDDEN)
- Use the mapper layer to transform Drizzle rows to API types — `packages/services/src/orgs/mapper.ts`

### Don't
- Do not query auth tables directly outside `packages/services/` — use the service functions
- Do not create custom oRPC routes for org/member/invitation writes — use better-auth's organization plugin client SDK (see §2, Organization Plugin)
- Do not store secrets in the `organization.billingSettings` JSON field
- Do not bypass better-auth's built-in role enforcement — the organization plugin endpoints handle owner-only restrictions for member role changes, member removal, and invitation management

### Error Handling

```typescript
// Service layer returns null or error objects for authz failures
const members = await orgs.listMembers(orgId, userId);
if (members === null) {
  throw new ORPCError("FORBIDDEN", { message: "Not a member" });
}

// Admin service uses typed errors
class ImpersonationError extends Error {
  code: "USER_NOT_FOUND" | "ORG_NOT_FOUND" | "NOT_A_MEMBER";
}
```

### Reliability
- Session expiry: 7 days, updated every 24 hours — `apps/web/src/lib/auth.ts:session`
- Invitation expiry: 7 days — `apps/web/src/lib/auth.ts:invitationExpiresIn`
- Impersonation cookie max age: 24 hours — `apps/web/src/lib/super-admin.ts:setImpersonationCookie`
- DB connection pool: max 1 connection, 10s idle timeout, 5s connect timeout — `apps/web/src/lib/auth.ts:pool`
- Personal org creation: best-effort (no retry on slug collision)

### Testing Conventions
- Auth helpers and service functions are tested via Vitest
- Mock `getSession()` for route-level tests
- Use `DEV_USER_ID` env var for local dev bypass (non-production only)

---

## 6. Subsystem Deep Dives

### 6.1 Authentication Flow — `Implemented`

**What it does:** Resolves the current user identity from one of three sources: cookie session, API key, or dev bypass.

**Happy path (cookie):**
1. `getSession()` in `apps/web/src/lib/auth-helpers.ts` is called
2. Checks `DEV_USER_ID` env var — if set and non-production, returns mock session
3. Checks `Authorization: Bearer <key>` header — calls `auth.api.verifyApiKey()`, looks up user, resolves org from `X-Org-Id` header or falls back to first membership
4. Falls through to `auth.api.getSession()` which reads the better-auth session cookie
5. `requireAuth()` wraps `getSession()`, adding impersonation overlay for super-admins

**Edge cases:**
- API key with `X-Org-Id` header: validates membership before using that org, falls back to first org if invalid
- Super-admin with impersonation cookie: swaps effective user/org but preserves `impersonation.realUserId` for audit
- `DEV_USER_ID=disabled`: explicitly disables dev bypass even when the env var exists

**Files touched:** `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/lib/super-admin.ts`

### 6.2 User Signup & Personal Org Creation — `Implemented`

**What it does:** Creates a personal organization and owner membership automatically when a new user registers.

**Happy path:**
1. User signs up via email/password or OAuth
2. better-auth creates the `user` record
3. `databaseHooks.user.create.after` fires in `apps/web/src/lib/auth.ts`
4. Hook creates org with `id=org_{userId}`, `name="{userName}'s Workspace"`, `slug="{slugified-name}-{userId.slice(0,8)}"`, `is_personal=true`
5. Hook creates member with `id=mem_{userId}`, `role=owner`
6. On next session creation, `databaseHooks.session.create.before` sets `activeOrganizationId` to the user's first org

**Edge cases:**
- Slug collision: `ON CONFLICT (slug) DO NOTHING` — silently skips if slug already exists
- Hook failure: logged as error, user creation still succeeds (org creation is best-effort)

**Files touched:** `apps/web/src/lib/auth.ts:databaseHooks`

### 6.3 Email Verification — `Implemented`

**What it does:** Optionally requires email verification before login, sending verification emails via Resend.

**Happy path:**
1. Controlled by `NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION` env var
2. When enabled: `emailAndPassword.requireEmailVerification=true` blocks login until verified
3. On signup, `emailVerification.sendOnSignUp=true` triggers `sendVerificationEmail` callback
4. Callback sends email via Resend with a verification link
5. `autoSignInAfterVerification=true` logs user in after clicking the link

**Edge cases:**
- Email disabled (`EMAIL_ENABLED=false` and no enforcement): verification is skipped entirely
- Missing `RESEND_API_KEY` with email enabled: throws at startup

**Files touched:** `apps/web/src/lib/auth.ts:emailVerification`

### 6.4 Organization & Member Management — `Implemented`

**What it does:** Provides two complementary surfaces: custom oRPC routes for read operations (list orgs, members, invitations) and better-auth organization plugin endpoints for write operations (role changes, member removal).

**Read path — custom oRPC (list members):**
1. `orgsRouter.listMembers` calls `orgs.listMembers(orgId, userId)` — `apps/web/src/server/routers/orgs.ts`
2. Service checks user membership via `orgsDb.getUserRole()` — `packages/services/src/orgs/service.ts`
3. If not a member, returns `null` (router throws FORBIDDEN)
4. Queries `member` table with user join — `packages/services/src/orgs/db.ts:listMembers`
5. Maps to API type via `toMembers()` — `packages/services/src/orgs/mapper.ts`

**Write path — better-auth plugin endpoints (role update, member removal):**
These operations are handled by better-auth's built-in organization plugin API routes (`/api/auth/organization/update-member-role`, `/api/auth/organization/remove-member`). Authorization is enforced by the plugin: only owners can change roles or remove members, and the owner role itself cannot be changed or removed. Evidence of usage: `apps/web/src/components/settings/members/use-members-page.ts`.

The service layer has parallel implementations (`updateMemberRole`, `removeMember` in `packages/services/src/orgs/service.ts`) with equivalent authz logic, but these are not wired to any router and are currently unused (see §9).

**Files touched:** `apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`, `packages/services/src/orgs/db.ts`

### 6.5 Invitation System — `Implemented`

**What it does:** Org members invite users by email; invitees accept or reject via a dedicated page.

**Happy path:**
1. Invitation created via better-auth's `organization.inviteMember()` client SDK call — plugin creates `invitation` record with 7-day expiry (`apps/web/src/lib/auth.ts:invitationExpiresIn`)
2. `sendInvitationEmail` callback fires, sending email via Resend with link `{APP_URL}/invite/{invitationId}` — `apps/web/src/lib/auth.ts`
3. Acceptance via `organization.acceptInvitation()` — plugin creates `member` record with the invited role
4. Rejection via `organization.rejectInvitation()` — plugin updates invitation status

**Listing invitations (custom oRPC):**
1. `orgsRouter.listInvitations` calls `orgs.listInvitations(orgId, userId)` — membership check included
2. DB query filters to current org, excludes expired invitations — `packages/services/src/orgs/db.ts:listInvitations`

**Edge cases:**
- Expired invitation: acceptance blocked by better-auth plugin (checks `expiresAt`)
- Email disabled: invitation record created but email skipped (log warning) — user must receive link another way
- Acceptance page evidence: `apps/web/src/app/invite/[id]/page.tsx`

**Files touched:** `apps/web/src/lib/auth.ts:sendInvitationEmail`, `packages/services/src/orgs/db.ts`

### 6.6 Domain Suggestions — `Implemented`

**What it does:** Suggests organizations matching the user's email domain for easy team discovery.

**Happy path:**
1. `orgsRouter.getDomainSuggestions` calls `orgs.getDomainSuggestions(userId, email)` — `apps/web/src/server/routers/orgs.ts`
2. Extracts domain from email (`email.split("@")[1]`) — `packages/services/src/orgs/service.ts`
3. Queries orgs where `allowedDomains` array contains the domain — `packages/services/src/orgs/db.ts:findByAllowedDomain`
4. Filters out orgs the user already belongs to
5. Returns suggestions with org id, name, slug, logo

**Domain management (service-layer only):**
`updateDomains(orgId, userId, domains)` exists in `packages/services/src/orgs/service.ts` with owner-only checks, domain validation (`/^[a-z0-9.-]+\.[a-z]{2,}$/`), and PostgreSQL array storage. However, it is not exposed through any oRPC route or frontend UI — domains can only be set via direct DB access or future API surface.

**Files touched:** `packages/services/src/orgs/service.ts:getDomainSuggestions`, `packages/services/src/orgs/db.ts:findByAllowedDomain`

### 6.7 Onboarding Flow — `Implemented`

**What it does:** Tracks onboarding progress (org, integrations, repos) and orchestrates trial activation + repo setup.

**Status check:**
1. `onboardingRouter.getStatus` calls `onboarding.getOnboardingStatus(orgId, nangoGithubIntegrationId)` — `apps/web/src/server/routers/onboarding.ts`
2. Checks: `hasOrg` (org exists), `hasSlackConnection` (active Slack installation), `hasGitHubConnection` (GitHub integration) — `packages/services/src/onboarding/service.ts`
3. Returns repos with prebuild status (`ready` if snapshotId exists, else `pending`).

**Dashboard gating:**
- Dashboard layout redirects to `/onboarding` when billing is enabled and `billingState === "unconfigured"` — `apps/web/src/app/dashboard/layout.tsx`
- GitHub connection is **optional** in the onboarding flow. "Skip GitHub" advances to the payment/complete step, not to the dashboard.
- Billing/trial step is still required when billing is enabled. Users cannot reach the dashboard without completing billing setup.

**Trial activation:**
1. `onboardingRouter.startTrial({ plan })` — `apps/web/src/server/routers/onboarding.ts`
2. If billing not enabled: marks onboarding complete, stores plan, returns success
3. If billing enabled: creates Autumn customer, calls `autumnAttach()` for payment method collection
4. If checkout URL returned: sends to frontend for Stripe/payment redirect
5. If no checkout needed: calls `orgs.initializeBillingState(orgId, "trial", TRIAL_CREDITS)` — handoff to billing. See `billing-metering.md` for credit policy.

**Mark complete:**
1. `onboardingRouter.markComplete` — called after checkout redirect returns
2. Sets `onboardingComplete=true` on org
3. Initializes billing state if still `unconfigured`

**Finalize (repo selection):**
1. `onboardingRouter.finalize({ selectedGithubRepoIds, integrationId })` — `apps/web/src/server/routers/onboarding.ts`
2. Fetches GitHub repos via integration, filters to selected IDs
3. Upserts each repo into DB, triggers repo snapshot build for new repos — `packages/services/src/onboarding/service.ts:upsertRepoFromGitHub`
4. Creates or retrieves managed prebuild via gateway service-to-service call
5. Returns `{ prebuildId, repoIds, isNew }`

**Files touched:** `apps/web/src/server/routers/onboarding.ts`, `packages/services/src/onboarding/service.ts`, `packages/services/src/onboarding/db.ts`

### 6.8 API Keys — `Implemented`

**What it does:** Provides long-lived Bearer tokens for CLI authentication, managed by better-auth's apiKey plugin.

**Creation:** Handled in CLI device auth flow. After device authorization, `auth.api.createApiKey({ body: { name: "cli-token", userId, expiresIn: undefined }})` creates a non-expiring key. See `cli.md` §6 for the full device auth flow.

**Verification:**
1. `getApiKeyUser()` in `apps/web/src/lib/auth-helpers.ts` extracts Bearer token from Authorization header
2. Calls `auth.api.verifyApiKey({ body: { key } })` — better-auth handles hash comparison
3. Looks up user details via `users.findById()`
4. Resolves org context from `X-Org-Id` header (validated via membership check) or first org

**Configuration:** Rate limiting disabled for CLI usage — `apps/web/src/lib/auth.ts:apiKey({ rateLimit: { enabled: false } })`

**Files touched:** `apps/web/src/lib/auth.ts:apiKey()`, `apps/web/src/lib/auth-helpers.ts:getApiKeyUser`

### 6.9 Admin & Impersonation — `Implemented`

**What it does:** Lets super-admins list all users/orgs, impersonate users, and switch orgs during impersonation.

**Admin status check (`getStatus`):**
1. Uses bare `os` middleware (not `adminProcedure`), so any authenticated user can call it — `apps/web/src/server/routers/admin.ts`
2. Requires a valid session (throws UNAUTHORIZED if not authenticated)
3. Checks `isSuperAdmin(email)` against comma-separated `SUPER_ADMIN_EMAILS` env var — `apps/web/src/lib/super-admin.ts`
4. Returns `{ isSuperAdmin: false }` for non-admins; includes impersonation state for admins

**Impersonation start:**
1. `adminRouter.impersonate({ userId, orgId })` — `apps/web/src/server/routers/admin.ts`
2. `adminProcedure` middleware verifies caller is super-admin
3. `admin.impersonate(userId, orgId)` validates user exists, org exists, user is member — `packages/services/src/admin/service.ts`
4. Sets `x-impersonate` httpOnly cookie (JSON-encoded `{userId, orgId}`, 24h max age, strict sameSite) — `apps/web/src/lib/super-admin.ts:setImpersonationCookie`
5. All subsequent `requireAuth()` calls detect the cookie and swap effective user/org context — `apps/web/src/lib/auth-helpers.ts:requireAuth`

**Org switching during impersonation:**
1. `adminRouter.switchOrg({ orgId })` reads current impersonation cookie
2. Validates impersonated user is member of target org — `admin.validateOrgSwitch()`
3. Updates cookie with new orgId

**Stop impersonation:**
1. `adminRouter.stopImpersonate` clears the `x-impersonate` cookie

**Files touched:** `apps/web/src/server/routers/admin.ts`, `packages/services/src/admin/service.ts`, `apps/web/src/lib/super-admin.ts`, `apps/web/src/lib/auth-helpers.ts`

### 6.10 Org Creation & Switching — `Implemented`

**What it does:** Users create team organizations and switch their active org context. Both operations are handled by better-auth's organization plugin as built-in API routes (`/api/auth/organization/*`). These plugin endpoints are first-class backend behavior owned by this spec — they are server-side routes auto-registered by better-auth, not frontend-only logic.

**Org creation (plugin endpoint):**
1. Client calls better-auth's `organization.create({ name, slug })` endpoint
2. Plugin creates `organization` record and `member` record with `creatorRole: "owner"` — `apps/web/src/lib/auth.ts` (plugin config)
3. Client then calls `organization.setActive({ organizationId })` to switch to the new org
4. Evidence of usage: `apps/web/src/components/onboarding/step-create-org.tsx`, `apps/web/src/components/dashboard/org-switcher.tsx`

**Org switching (plugin endpoint):**
1. Client calls better-auth's `organization.setActive({ organizationId })` endpoint
2. Plugin updates `session.activeOrganizationId` in the database
3. Impersonating super-admins use `adminRouter.switchOrg` instead (see §6.9)

**Files touched:** `apps/web/src/lib/auth.ts` (plugin config)

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `billing-metering.md` | This → Billing | `autumnCreateCustomer()`, `autumnAttach()`, `TRIAL_CREDITS`, `initializeBillingState()` | Onboarding triggers trial; billing owns credit policy |
| `cli.md` | CLI → This | `auth.api.createApiKey()`, `auth.api.verifyApiKey()` | CLI device auth creates API keys; auth-helpers verifies them |
| `sessions-gateway.md` | Gateway → This | `verifyToken()`, `verifyInternalToken()` | Gateway auth middleware uses shared JWT/token helpers |
| `integrations.md` | This → Integrations | `onboarding.getIntegrationForFinalization()` | Onboarding finalize fetches GitHub integration for repo listing |
| `repos-prebuilds.md` | This → Repos | `getOrCreateManagedPrebuild()`, `createRepoWithConfiguration()` | Onboarding finalize creates repos with auto-configurations (which trigger snapshot builds) |

### Security & Auth
- **AuthN:** better-auth manages session tokens (httpOnly cookies), password hashing, and OAuth flows
- **AuthZ:** Three-tier for oRPC reads: `publicProcedure` (no auth), `protectedProcedure` (any user), `orgProcedure` (user + active org). Owner-only write operations (role changes, member removal) enforced by better-auth's organization plugin.
- **Impersonation audit:** `ImpersonationContext` with `realUserId`/`realUserEmail` is propagated through middleware context
- **Sensitive data:** Impersonation cookie is httpOnly, secure in production, strict sameSite, 24h max. API key values are hashed by better-auth. Passwords are hashed in the `account` table.
- **Super-admin list:** Configured via `SUPER_ADMIN_EMAILS` env var (comma-separated). Not stored in DB.

### Observability
- Auth module logger: `apps/web/src/lib/auth.ts` — child logger `{ module: "auth" }`
- Auth helpers logger: `apps/web/src/lib/auth-helpers.ts` — child logger `{ module: "auth-helpers" }`
- Onboarding router logger: `apps/web/src/server/routers/onboarding.ts` — child logger `{ handler: "onboarding" }`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Auth-related tests pass
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Personal org slug collision** — `ON CONFLICT DO NOTHING` silently skips org creation if slug collides. User ends up with no org. Low probability due to userId suffix but not impossible. — Expected fix: add retry with randomized suffix.
- [ ] **Unwired service-layer functions** — `updateDomains`, `updateMemberRole`, `removeMember` exist in `packages/services/src/orgs/service.ts` with full authz logic but are not exposed via any oRPC route. Member management goes through better-auth's organization plugin client SDK instead, duplicating role/removal logic. — Impact: dead code, confusing ownership. Expected fix: either wire to routes or remove.
- [ ] **No org deletion** — Organizations cannot be deleted through the API. Only member removal and role changes are supported. — Expected fix: add soft-delete with cascade cleanup.
- [ ] **Single owner model** — Only one user can be owner; no ownership transfer mechanism exists. — Expected fix: add `transferOwnership` endpoint.
- [ ] **Invitation deduplication** — No check for duplicate pending invitations to the same email. — Expected fix: upsert or reject duplicates.
- [ ] **Session org context drift** — `activeOrganizationId` is set at session creation via hook and updated by better-auth's `organization.setActive()`. If a user is removed from an org mid-session, the session still references that org until refresh. — Impact: low, requests fail at membership check.
- [ ] **billingSettings stored as text** — `organization.billingSettings` is JSON serialized as `TEXT` instead of `JSONB` for better-auth compatibility. No query-time JSON operations available. — Impact: minor, always read/written as whole blob.
