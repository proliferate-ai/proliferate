# Auth, Orgs & Onboarding — System Spec

## 1. Scope & Purpose

### In Scope
- User authentication via better-auth (email/password plus GitHub/Google OAuth)
- Email verification flow (Resend-backed, environment-gated)
- Auth provider metadata for login UI
- Gateway WebSocket token issuance for authenticated users
- Organization model: personal org bootstrapping, team org creation, active-org switching
- Member management and invitation lifecycle
- Domain suggestions from organization allowed domains
- Onboarding status, onboarding completion, and trial activation handoff
- API key issuance/verification for CLI authentication
- Admin identity surface: super-admin checks, user/org listing, impersonation and org switching while impersonating
- Auth middleware chain: session resolution, API-key fallback, impersonation overlay

### Out of Scope
- Billing policy, credit math, metering, and enforcement logic (see `billing-metering.md`)
- Gateway-side WebSocket auth middleware and real-time session lifecycle (see `sessions-gateway.md`)
- Full CLI device-auth product flow and local runtime behavior (see `cli.md`)
- OAuth connection lifecycle via Nango/GitHub App (see `integrations.md`)
- Action execution policy beyond org-level mode persistence/read APIs (see `actions.md`)

### Mental Models
- Identity is a composed context, not a single token check. The effective actor is built from auth source resolution (`apps/web/src/lib/auth-helpers.ts`), optional impersonation overlay (`apps/web/src/lib/super-admin.ts`), and active organization context (`apps/web/src/server/routers/middleware.ts`).
- Organization membership is the primary authorization primitive. Most org-scoped reads re-check membership at service level, even when upstream middleware already required auth (`packages/services/src/orgs/service.ts`).
- `activeOrganizationId` is a routing hint, not a universal authorization guarantee. It is required for `orgProcedure`, but access to a specific org ID is still validated by membership checks in org services.
- better-auth owns identity write surfaces for core auth/org tables and plugin routes. The Proliferate service layer mainly adds read composition, enrichment, and product-specific behavior around those primitives.
- Onboarding completion is organization state, but UX safety behavior is user-aware: completion can be propagated across all user org memberships to prevent looping (`apps/web/src/server/routers/onboarding.ts`, `packages/services/src/orgs/db.ts`).
- Impersonation is an overlay on top of a real super-admin session. It does not create a second auth session; it rewrites effective user/org context for downstream handlers.

### Things Agents Get Wrong
- better-auth organization operations are server endpoints, not client-only helpers. The client SDK calls plugin-backed routes mounted under `apps/web/src/app/api/auth/[...all]/route.ts`.
- Org/member/invitation writes are mostly plugin-owned (`organization.create`, `organization.setActive`, `organization.inviteMember`, `organization.updateMemberRole`, `organization.removeMember`, `organization.acceptInvitation`) and are invoked in frontend code (`apps/web/src/components/settings/members/use-members-page.ts`, `apps/web/src/app/invite/[id]/page.tsx`).
- `orgProcedure` does not mean "input org ID equals active org ID". It only requires an active org to exist; service methods still enforce membership against the requested org ID (`apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`).
- Auth resolution precedence is strict: dev bypass, then API key, then cookie session (`apps/web/src/lib/auth-helpers.ts:getSession`).
- `DEV_USER_ID` bypass is active in non-production or CI unless explicitly set to `disabled`; this logic exists both in auth helpers and better-auth GET session route wrapper (`apps/web/src/lib/auth-helpers.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`).
- "First organization" fallback is not explicitly ordered by creation time or role (`packages/services/src/orgs/db.ts:getUserOrgIds`, `packages/services/src/cli/db.ts:getUserFirstOrganization`), so consumers should treat it as best-effort defaulting.
- Invitation acceptance is two-phase: pre-auth basic invite resolution via server action/service, then authenticated better-auth invitation fetch with email-match enforcement in UI (`apps/web/src/app/invite/actions.ts`, `apps/web/src/app/invite/[id]/page.tsx`).
- Personal-org deletion after invite acceptance is best-effort and intentionally blocked when org-scoped sessions still exist (`packages/services/src/orgs/db.ts:deletePersonalOrg`).
- API keys are created at CLI poll completion, not at device authorization submission (`apps/web/src/server/routers/cli.ts:pollDevice`).
- Super-admin status is environment-driven (`SUPER_ADMIN_EMAILS`), not persisted in DB (`apps/web/src/lib/super-admin.ts`).
- `admin.getStatus` is auth-required but not super-admin-only by design (it returns `isSuperAdmin: false` for normal users), while `adminProcedure` gates privileged admin endpoints (`apps/web/src/server/routers/admin.ts`).
- Onboarding gates are enforced in layout-level client routing using onboarding status and billing state, not only in route handlers (`apps/web/src/app/(command-center)/layout.tsx`, `apps/web/src/app/(workspace)/layout.tsx`).

---

## 2. Core Concepts

### better-auth
better-auth is the source framework for authentication/session/account lifecycle and plugin-backed org/API-key behavior.
- Reference: `apps/web/src/lib/auth.ts`

### Auth Context Composition
Auth context is built from middleware helpers, not directly from cookies everywhere. `requireAuth()` produces the effective user/session/org context and optional impersonation metadata consumed by oRPC middleware.
- Reference: `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/server/routers/middleware.ts`

### Organization Plugin Ownership
The organization plugin is the write-plane for most organization lifecycle operations. Proliferate-specific oRPC routes primarily expose read composition and app-specific adjunct behavior.
- Reference: `apps/web/src/lib/auth-client.ts`, `apps/web/src/server/routers/orgs.ts`

### Invitation + Onboarding Coupling
Invitation acceptance is identity/org membership behavior, but post-accept UX (active-org switch and optional personal-org cleanup) is implemented in the invite experience and org service.
- Reference: `apps/web/src/app/invite/[id]/page.tsx`, `apps/web/src/app/invite/actions.ts`, `packages/services/src/orgs/service.ts`

### API Key Path for CLI
API keys are better-auth resources used as Bearer credentials in web middleware and internal verification routes. Org context may come from headers or fallback membership lookup.
- Reference: `apps/web/src/server/routers/cli.ts`, `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/app/api/internal/verify-cli-token/route.ts`

### Super-Admin Impersonation
Impersonation is a cookie-backed overlay gated by super-admin checks and membership validation before activation or org switching.
- Reference: `apps/web/src/server/routers/admin.ts`, `packages/services/src/admin/service.ts`, `apps/web/src/lib/super-admin.ts`

---

## 5. Conventions & Patterns

### Do
- Use `protectedProcedure` for authenticated routes and `orgProcedure` when active-org context is required (`apps/web/src/server/routers/middleware.ts`).
- Re-check organization membership in service layer before returning org-scoped data (`packages/services/src/orgs/service.ts`).
- Use mapper functions to convert Drizzle rows into contract-facing shapes (`packages/services/src/orgs/mapper.ts`).
- Keep DB operations in `packages/services/src/**/db.ts` and keep routers thin.

### Don't
- Do not bypass better-auth plugin write endpoints with ad hoc router writes for org/invitation/member lifecycle.
- Do not treat `activeOrganizationId` as sufficient authorization for arbitrary org IDs.
- Do not add auth-table writes outside better-auth lifecycle hooks/plugins unless explicitly justified.
- Do not rely on frontend gating alone for security-sensitive checks.

### Error Handling
- Service-layer authz failures commonly return `null` or typed error results; routers map these to `ORPCError` status codes (`apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`).
- Admin impersonation validation uses typed domain errors (`ImpersonationError`) that routers translate to API error semantics (`packages/services/src/admin/service.ts`, `apps/web/src/server/routers/admin.ts`).

### Reliability
- Session duration is 7 days, with 24-hour update age (`apps/web/src/lib/auth.ts:session`).
- Invitation expiration is 7 days (`apps/web/src/lib/auth.ts:organization({ invitationExpiresIn })`).
- Impersonation cookie is httpOnly, strict sameSite, 24-hour max age (`apps/web/src/lib/super-admin.ts:setImpersonationCookie`).
- Personal org creation/deletion paths are intentionally best-effort and non-blocking relative to auth success UX.

### Testing Conventions
- Test service functions and route handlers (Vitest), especially auth context assembly and org membership enforcement.
- Validate both cookie-session and API-key auth paths when changing auth middleware behavior.
- Keep `DEV_USER_ID` bypass assumptions explicit in tests that cover local/CI-only auth behavior.

---

## 6. Subsystem Invariants

### 6.1 Authentication Context Resolution — `Implemented`

**Invariants**
- Exactly one auth source produces the request identity: dev bypass, API key, or cookie session, in that precedence order.
- API-key auth is only valid when `auth.api.verifyApiKey` returns a valid key and backing user exists.
- If `x-org-id` is provided with API key auth, organization context is only accepted when membership exists; otherwise fallback org resolution is used.
- `requireAuth` never silently returns unauthenticated context; missing/invalid auth yields explicit unauthorized result.
- Impersonation overlay only applies when the real authenticated user is a super-admin.

**Rules**
- New authenticated surfaces must consume `requireAuth` or middleware built on it, not custom ad hoc auth parsing.
- Any new auth source must preserve deterministic precedence and explicit failure semantics.

**Evidence**
- `apps/web/src/lib/auth-helpers.ts`
- `apps/web/src/server/routers/middleware.ts`

### 6.2 Signup & Personal Organization Bootstrapping — `Partial`

**Invariants**
- User creation attempts personal org creation and owner membership creation via better-auth DB hooks.
- Personal org creation failure does not block user signup completion.
- Session creation attempts to stamp `activeOrganizationId` from first discovered membership.

**Rules**
- Keep this path non-blocking for auth UX, but treat failures as observable operational debt.
- Any change to personal-org semantics must preserve idempotency/safety across retries and collisions.

**Evidence**
- `apps/web/src/lib/auth.ts:databaseHooks`

### 6.3 Email Verification & Invitation Email Delivery — `Implemented`

**Invariants**
- Email verification enforcement is environment-gated and can hard-block login until verification.
- If email delivery is enabled, `RESEND_API_KEY` and `EMAIL_FROM` are required at startup.
- Invitation records can still be created when email delivery is unavailable; email send is skipped with warning.

**Rules**
- Verification requirements and invitation delivery behavior must remain configuration-driven, not hardcoded by environment assumptions.

**Evidence**
- `apps/web/src/lib/auth.ts`

### 6.4 Organization Reads/Writes Authorization Boundary — `Partial`

**Invariants**
- Custom oRPC org routes provide read operations (org list, org detail, members, invitations, domain suggestions, action modes) with service-level authz checks.
- Most org/member/invitation writes are performed through better-auth organization plugin endpoints called by frontend client SDK.
- `setActionMode` is an explicit exception handled in service/router with owner/admin enforcement.
- Service-layer write helpers for domains/member-role/member-removal exist but are not currently wired to oRPC routes.

**Rules**
- Keep write ownership explicit: either plugin-owned or service-owned, never ambiguous duplicate paths without clear rationale.
- Any org-scoped read route must validate membership against requested org ID.

**Evidence**
- `apps/web/src/server/routers/orgs.ts`
- `packages/services/src/orgs/service.ts`
- `apps/web/src/components/settings/members/use-members-page.ts`

### 6.5 Invitation Acceptance Experience — `Implemented`

**Invariants**
- Public basic invitation lookup only resolves pending, non-expired invitation metadata.
- Full invitation details require authenticated better-auth flow and intended email alignment.
- Successful acceptance switches active org to invited org and may attempt personal-org cleanup as best-effort.
- Rejection does not auto-create replacement org context; UX redirects to onboarding path.

**Rules**
- Preserve email-alignment guardrails on invite acceptance flows.
- Keep personal-org cleanup optional and failure-tolerant.

**Evidence**
- `packages/services/src/orgs/service.ts:getBasicInvitationInfo`
- `apps/web/src/app/invite/actions.ts`
- `apps/web/src/app/invite/[id]/page.tsx`

### 6.6 Onboarding & Trial Activation — `Implemented`

**Invariants**
- Onboarding status is org-scoped and returns safe defaults when no active org exists.
- `markComplete` updates the active org and attempts to mark all user orgs as complete to avoid onboarding loops.
- `getStatus` can auto-complete active org onboarding when another user org is already complete.
- Trial start chooses billing-enabled vs billing-disabled path; billing policy remains delegated to billing services.

**Rules**
- Keep billing policy and credit calculations out of auth/onboarding domain logic.
- Preserve loop-prevention behavior across org switching unless explicitly redesigned.

**Evidence**
- `apps/web/src/server/routers/onboarding.ts`
- `packages/services/src/onboarding/service.ts`
- `packages/services/src/orgs/db.ts`
- `apps/web/src/app/(command-center)/layout.tsx`
- `apps/web/src/app/(workspace)/layout.tsx`

### 6.7 API Key Lifecycle — `Implemented`

**Invariants**
- CLI API key issuance happens during device poll completion, not during device authorization submit.
- API key verification for web requests runs through better-auth and resolves org context via header-validated membership or fallback membership.
- Internal CLI token verification route is protected by service-to-service token and returns user plus best-effort org context.

**Rules**
- Keep API key value handling delegated to better-auth (hashing/verification), not custom crypto paths.
- Keep internal token-verification endpoints isolated behind service auth headers.

**Evidence**
- `apps/web/src/server/routers/cli.ts:pollDevice`
- `apps/web/src/lib/auth-helpers.ts:getApiKeyUser`
- `apps/web/src/app/api/internal/verify-cli-token/route.ts`

### 6.8 Super-Admin & Impersonation — `Partial`

**Invariants**
- Super-admin authority is derived from `SUPER_ADMIN_EMAILS` list.
- Privileged admin mutations (`listUsers`, `listOrganizations`, `impersonate`, `stopImpersonate`, `switchOrg`) require `adminProcedure` super-admin checks.
- Impersonation start and org switch both require membership validation against the impersonated user.
- Impersonation cookie state may become stale; admin status APIs degrade to non-impersonating state when referenced user/org no longer exists.

**Rules**
- Impersonation must remain an overlay with explicit audit identity (`realUserId`, `realUserEmail`) in middleware context.
- Any new privileged admin endpoint must explicitly choose between "auth-required" and "super-admin-required" semantics.

**Evidence**
- `apps/web/src/server/routers/admin.ts`
- `packages/services/src/admin/service.ts`
- `apps/web/src/lib/super-admin.ts`
- `apps/web/src/lib/auth-helpers.ts:requireAuth`

### 6.9 Organization Creation & Active Org Switching — `Implemented`

**Invariants**
- Team org creation is allowed via better-auth organization plugin with creator role set to owner.
- Active org switching is plugin-managed for normal users (`organization.setActive`) and cookie-overlay managed for impersonating super-admins.
- UI surfaces call plugin client methods directly for org create/switch in onboarding and dashboard settings flows.

**Rules**
- Keep plugin as default owner for org create/switch lifecycle unless there is a deliberate migration plan.

**Evidence**
- `apps/web/src/lib/auth.ts:organization`
- `apps/web/src/components/onboarding/step-create-org.tsx`
- `apps/web/src/components/dashboard/org-switcher.tsx`
- `apps/web/src/server/routers/admin.ts:switchOrg`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `billing-metering.md` | This → Billing | `autumnCreateCustomer()`, `autumnAttach()`, `TRIAL_CREDITS`, `initializeBillingState()` | Onboarding triggers billing initialization; billing owns policy and reconciliation |
| `cli.md` | CLI → This | `auth.api.createApiKey()`, `auth.api.verifyApiKey()`, device auth routes | Device auth mints API keys; auth middleware and internal routes verify them |
| `sessions-gateway.md` | Gateway → This | Web token claims (`sub`, `email`, `orgId`), auth helpers | Gateway trusts issued JWTs and user/org claim semantics |
| `integrations.md` | This → Integrations | `onboarding.getIntegrationForFinalization()`, GitHub integration status | Onboarding depends on org-bound integration state |
| `repos-prebuilds.md` | This → Repos | `getOrCreateManagedConfiguration()`, onboarding repo upsert path | Onboarding finalization provisions repo/configuration scaffolding |
| `actions.md` | This ↔ Actions | Org-level `actionModes` read/write surface | Auth/org scope stores org-level default action mode values |

### Security & Auth
- better-auth owns session/auth/account primitives and API key verification (`apps/web/src/lib/auth.ts`).
- oRPC authz tiers are explicit: `publicProcedure`, `protectedProcedure`, `orgProcedure` (`apps/web/src/server/routers/middleware.ts`).
- Impersonation metadata is propagated for audit-aware downstream behavior (`apps/web/src/lib/auth-helpers.ts`).
- Super-admin trust root is environment configuration, not mutable DB state (`apps/web/src/lib/super-admin.ts`).

### Observability
- Auth logger module: `apps/web/src/lib/auth.ts`
- Auth helper logger module: `apps/web/src/lib/auth-helpers.ts`
- Onboarding router logger: `apps/web/src/server/routers/onboarding.ts`
- Admin/router paths rely mostly on structured ORPC error mapping with contextual logs in services/routers

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Auth/org/onboarding/admin-related tests pass
- [ ] Spec reflects current architecture with Sections 3 and 4 intentionally removed, and Section 6 expressed as declarative invariants

---

## 9. Known Limitations & Tech Debt

- [ ] **Personal org creation is best-effort only** — signup hook uses `ON CONFLICT (slug) DO NOTHING`; collision/failure can leave user without auto-provisioned org. (`apps/web/src/lib/auth.ts`)
- [ ] **Service-layer org write paths are partially unwired** — `updateDomains`, `updateMemberRole`, `removeMember` exist in `packages/services/src/orgs/service.ts` but primary product writes use better-auth plugin calls from frontend. Ownership is duplicated and unclear.
- [ ] **First-org fallback is non-deterministic** — fallback org resolution uses first matched membership without explicit ordering in multiple paths (`packages/services/src/orgs/db.ts:getUserOrgIds`, `packages/services/src/cli/db.ts:getUserFirstOrganization`).
- [ ] **Active org context can drift from current membership** — session `activeOrganizationId` can remain stale until switched/refreshed; service-level membership checks catch this late (`apps/web/src/lib/auth.ts`, `packages/services/src/orgs/service.ts`).
- [ ] **Personal-org cleanup after invite accept is opportunistic** — deletion is skipped when org-scoped sessions exist, leaving extra personal orgs for some users (`packages/services/src/orgs/db.ts:deletePersonalOrg`).
- [ ] **`admin.sentryTestError` is publicly callable in oRPC router** — endpoint is not behind auth middleware in current code (`apps/web/src/server/routers/admin.ts`). If this is intended only for controlled environments, scope should be tightened or explicitly gated.
