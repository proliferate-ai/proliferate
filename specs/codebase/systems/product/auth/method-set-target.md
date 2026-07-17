# Proposed hosted Desktop and Web authentication method contract

Status: proposed target; draft and not accepted.

Date: 2026-07-17.

Evidence baseline: `8c447f232cf2a4ee7b611024f8684516854e5e14`.

This draft proposes a sign-in experience and security boundary for installed
Desktop when it uses the hosted control plane and for hosted Web. It is
intentionally limited to GitHub, Google, and customer SSO, plus the
domain-verification, account-binding, and session-scope work required to expose
those methods safely.

This proposal is not current architecture and does not authorize implementation.
The current [Product Auth](README.md) contract remains authoritative. The
founder and security owners must explicitly accept the checklist in
[Unresolved acceptance decisions](#unresolved-acceptance-decisions) before this
document can be promoted to `Status: target` or assigned to implementation.
Normative language below describes the requirements that would apply only if
that promotion occurs.

## Proposed decision

Hosted Desktop and Web present the same signed-out method set, in this order:

1. `Continue with GitHub`
2. `Continue with Google`
3. `Continue with SSO`

`Continue with SSO` opens the same customer-domain discovery flow on both
surfaces. The UI may collect a work email, but ProductClient extracts and sends
only its domain. Organization slug URLs and invitation URLs remain supported
entry transports, but a separate slug field is not a fourth sign-in method.

Sign-in identity and product integrations are separate concepts. GitHub is no
longer a global product-entry prerequisite for an account that authenticated
with Google or customer SSO. A feature that actually needs GitHub credentials
must request GitHub at its point of use. Existing free-credit anti-abuse policy
may continue to require GitHub; this contract does not change credit policy.

### Hosted method matrix

| Target posture | Desktop | Web | Required behavior |
| --- | --- | --- | --- |
| Hosted, standard | GitHub, Google, SSO | GitHub, Google, SSO | The method order, labels, availability, and recovery behavior match. |

Self-managed Desktop and self-managed Web chooser behavior are not part of this
proposal. Existing self-managed Desktop provider, deployment-SSO, password, and
local-continuation behavior remains current. Self-managed Web is deferred until
the separate follow-up already required by the
[Web/Desktop unification contract](../clients/web-desktop-unification/README.md)
defines its configuration and deployment contract. Shared identity and session
storage must still represent deployment SSO correctly so this hosted change does
not corrupt existing self-managed identities or credentials.

Apple remains a Mobile and already-linked-account compatibility provider. It
is not shown as a hosted Desktop or Web sign-in method. Existing Apple links
are not removed by this work. Operational password fallback is likewise outside
the hosted chooser and is not redesigned here.

## Confirmed current gaps

The proposed target would close these source- and product-confirmed gaps:

| Concern | Current evidence | Target correction |
| --- | --- | --- |
| Visible methods | The thin Web host publishes GitHub, Google, and SSO in anonymous host state, and its transport can start all three, but ProductClient does not consume that method list. The shared `AuthShell` renders GitHub, deployment SSO, and a password fallback only; no Google login action is wired. Desktop uses the same shell and rejects Google login except for an explicit account-link purpose. | Both hosts consume one server capability manifest, and ProductClient renders every declared hosted method through one shared presentation contract. |
| Customer SSO entry | ProductClient's default SSO probe has no organization or domain input and therefore discovers deployment SSO only. Its separate `/login` page can show a slug field. Web's `/login/:slug` decoder currently seeds router state that ProductClient does not consume, so it does not prefill that field. | One SSO action opens one domain-first flow on both hosts; slug and invitation transports feed the same callback, binding, and scoped-session rules. |
| Domain trust | Organization `allowed_domains` values are admin-entered callback allowlists. They are neither ownership-verified nor unique and therefore cannot safely route public sign-in. | A separately verified, uniquely claimed routing domain is required before domain discovery can select an organization connection. |
| Account binding | An organization IdP's verified email can currently select an unrelated existing global user and attach a new SSO identity. Provider behavior also differs when an OAuth email already exists. | Provider subject is the login key. An email collision enters an explicit authenticated linking flow; email alone never attaches an identity. |
| Session authority | Organization SSO mints an ordinary global session. Some product gates treat the SSO membership as sufficient while organization actor checks do not, producing both over-broad and inconsistent authority. | Organization SSO creates an organization-bound session whose authorization and refresh scope cannot escape that organization. |
| Product readiness | After authentication, the Web host can publish `action_required/connect_github`, although ProductClient does not consume that readiness state or render the removed pre-unification Connect-GitHub screen; server product endpoints still enforce current GitHub readiness. | Google and valid organization SSO are sufficient to enter the product; GitHub-dependent features enforce their own requirement. |
| Session persistence | Web uses an HttpOnly refresh cookie while Desktop persists bearer credentials, but logout invalidates all sessions through a user-wide token generation. | Each session family has an explicit id and scope; ordinary logout revokes only the current family, while security events retain a separate revoke-all operation. |

Source inspection on the evidence baseline also confirms that ProductClient
account settings can show GitHub, Google, Apple, SSO, and password status while
the signed-out shell has a different set, and that organization SSO accepts
unverified comma-separated allowed domains. Google linking is wired even though
Google login is not. These are model/presentation mismatches, not evidence that
every linked provider should appear on the sign-in screen.

Current source anchors:

- `apps/web/src/WebHostApp.tsx` mounts ProductClient and retains only narrow
  browser entry routes; `apps/web/src/web-host.ts` publishes the static hosted
  method list, and `apps/web/src/browser/auth/web-auth-transport.ts` implements
  browser transport.
- `apps/packages/product-client/src/components/auth/AuthShell.tsx` and
  `apps/packages/product-client/src/components/auth/AuthScreenLayout.tsx` own
  the rendered default chooser. ProductClient's
  `apps/packages/product-client/src/hooks/auth/workflows/use-sso-sign-in.ts`
  performs the no-input deployment probe; there is no Google login workflow
  wired into that chooser.
- `apps/desktop/src/providers/DesktopProductHostProvider.tsx` and
  `apps/desktop/src/providers/desktop-product-host.ts` own native transport and
  current method-state construction, not auth presentation.
- `apps/web/src/browser/links/OrganizationJoinRoute.tsx` owns the narrow Web
  invitation entry. ProductClient owns persisted join intent, sign-in launch,
  Account navigation, and explicit acceptance for invitations that remain
  pending under its organization hooks and `AccountPane`.

## Ownership

| Owner | Responsibilities | Must not own |
| --- | --- | --- |
| ProductClient | Method ordering and labels; method chooser, domain-first SSO, callback, linking, and recovery states; client-local email parsing; accessible focus and status behavior; product auth telemetry names and low-cardinality properties. | Browser cookies, native deep links, secure storage, raw Tauri calls, provider SDKs, or server authorization policy. |
| Web host | HTTPS callback entry, PKCE verifier storage for the active browser transaction, HttpOnly-cookie session bootstrap, CSRF transport, and browser navigation. | A second method taxonomy, provider ordering, or Web-only auth error copy. |
| Desktop host | System-browser launch, `proliferate://auth/callback` delivery, PKCE verifier storage, OS-secure session persistence, and local-only continuation. | A Desktop-only method taxonomy or customer-domain routing policy. |
| Server auth | Method manifest; OAuth and OIDC challenges; verified-domain claims and discovery; identity binding; session mint/refresh/revocation; beta and deployment policy; stable error codes. | Client presentation choices or storage of raw discovery emails for analytics. |
| Organization admin surface | Create, verify, inspect, and revoke SSO routing-domain claims; configure and test the IdP connection. | Declaring a domain trusted merely by typing it into `allowed_domains`. |

ProductClient is the sole long-term presentation owner under the
[Web/Desktop unification](../clients/web-desktop-unification/README.md)
contract. Both thin hosts already mount it. A future implementation extends the
shared ProductClient auth flow and the narrow host transports; it must not add
another Web- or Desktop-local presentation.

## Public capability contract

Desktop and Web load one public method manifest before rendering actions:

```http
GET /auth/methods?surface=desktop
GET /auth/methods?surface=web
```

```json
{
  "mode": "standard",
  "methods": [
    { "kind": "provider", "provider": "github" },
    { "kind": "provider", "provider": "google" },
    { "kind": "sso", "discovery": "customer_domain" }
  ]
}
```

This hosted proposal defines only the `standard` mode shown above. A method
omitted from this response is not rendered or invoked. The response exposes no
organization id, connection id, configured domain, provider secret, or internal
policy reason. It does not define a self-managed Web manifest, a deployment-SSO
chooser mode, or password-fallback UX.

The manifest is cacheable only for a short server-declared period and clients
must refetch after a deployment change or a stable `auth_methods_changed`
error. Failure to load the manifest renders a retry state, not a guessed list
of methods.

The manifest is presentation, not authorization. Every provider, password, and
SSO discovery/start endpoint re-evaluates the current hosted policy, surface,
method configuration, and purpose before creating a challenge. A direct
`purpose=login` call for a method omitted by policy fails with
`auth_method_not_allowed`; hiding its button is not the security boundary. An
authenticated `purpose=link` or integration-consent flow may remain available
when its own policy permits, but it cannot mint or replace a login session.

During migration, existing provider-availability and deployment-SSO probes may
back the server implementation internally. ProductClient stops combining those
probes, and the Web host removes its static anonymous method advertisement, once
the manifest ships. Existing self-managed clients keep their current probes
until a separate accepted contract replaces them.

## Customer-domain SSO

### Routing-domain model

`SsoConnection.allowed_domains` remains an IdP-assertion allowlist. It answers
whether a callback email may use that connection; it is not proof that the
organization owns a domain and is never a discovery index.

Add a durable routing-domain claim with at least:

| Field | Contract |
| --- | --- |
| `id` | Opaque identifier. |
| `organization_id` | Owning organization. |
| `connection_id` | Enabled organization SSO connection used after discovery. |
| `domain_ascii` | Lowercase IDNA ASCII domain, with no leading `@`, wildcard, port, path, or public suffix. |
| `status` | `pending`, `verified`, `expired`, or `revoked`. |
| `verification_token_hash` | Hash of the generated DNS proof; the plaintext token is returned only when the claim is created or rotated. |
| timestamps | Created, pending expiry, last checked, verified, and revoked times. A pending lease expires after 14 days unless rotated. |

Pending claims are expiring leases and do not reserve a domain. Multiple
organizations may have a pending claim for the same normalized domain, which
allows duplicate legacy `allowed_domains` rows and prevents an unverified typo
or malicious request from squatting the name. A partial database unique index
permits only one `verified` claim per normalized domain; application checks
alone are insufficient. Verification serializes contenders for that domain.
The first valid DNS proof promoted in the transaction wins, and the same
transaction expires all other pending contenders. A later contender receives
`sso_domain_already_claimed` without holder metadata. Revocation permits a new
proof to win; stale DNS proof material never transfers the old claim.

The admin API is organization-admin protected:

```text
GET    /organizations/{organizationId}/sso/domains
POST   /organizations/{organizationId}/sso/domains
POST   /organizations/{organizationId}/sso/domains/{domainId}/rotate
POST   /organizations/{organizationId}/sso/domains/{domainId}/verify
DELETE /organizations/{organizationId}/sso/domains/{domainId}
```

Creation returns a DNS TXT challenge for
`_proliferate-sso.<domain>`. Verification performs a fresh DNS lookup, uses a
constant-time token comparison, and records only the hash. A conflict returns
`sso_domain_already_claimed` without identifying the other organization.
Verification cannot succeed unless the connection belongs to the organization
and has passed its existing configuration test. Discovery becomes available
only while the claim is verified and the connection is enabled. Connection
disable, claim revocation, or failed periodic revalidation fails closed.

Migration normalizes and validates existing `allowed_domains` values first.
Valid values are imported as expiring `pending` leases and are never
grandfathered as verified. Duplicate valid values remain independent pending
contenders; no organization is chosen as a migration winner, and DNS proof
decides verification. Invalid, wildcard, and public-suffix values create no
claim and produce an admin-visible audit warning without exposing another
organization. An admin rotates an imported lease to obtain a fresh proof.

### Discovery API

The ProductClient UI may collect a work email, but it parses and retains the
local part and full address only in transient client memory. Discovery sends
only the normalized domain. The surface is part of the route so the JSON body
has exactly one field:

```http
POST /auth/{surface}/sso/domain-discovery
Content-Type: application/json

{ "domain": "example.com" }
```

`surface` is `desktop` or `web`. The server rejects unknown body fields,
including `email`, `localPart`, and `surface`, rather than silently accepting a
full address. It normalizes and validates the domain again before lookup.

For a single verified, enabled match:

```json
{
  "enabled": true,
  "discoveryToken": "opaque-short-lived-value"
}
```

Every unknown, pending, revoked, disabled, malformed, or otherwise unavailable
domain returns the same `200` response:

```json
{ "enabled": false, "reason": "not_available" }
```

The server does not receive the local part or full email during discovery and
does not persist or place the domain in URLs, logs, traces, metrics, or
analytics. Rate limiting uses a per-network bucket and an independent keyed-hash
per-domain bucket, so changing domains does not bypass network limits and
distributed attempts do not bypass domain limits. The success token is
body-only, one-time, expires within ten minutes, and is bound to the connection,
verified claim version, surface, and discovery purpose. It exposes no ids to the
client and becomes invalid when the claim, connection, or accepted connection
security revision changes.

Success versus failure necessarily reveals that a tested domain participates
in Proliferate SSO; the subsequent redirect makes that domain-level fact
observable. The proposal treats this bounded domain-level leakage, rather than
account or full-email disclosure, as an explicit security acceptance decision.
Discovery returns no tenant branding, organization/connection id, or policy
detail, and every address at the same normalized domain receives the same
result.

`POST /auth/{surface}/sso/start` accepts `discoveryToken` for the customer flow.
The server, not the client, expands it to organization and connection context.
This proposal does not send the full email to that endpoint or set an IdP
`login_hint`.

Any later login-hint feature is a separate security-reviewed flow, not an
extension that may silently widen domain discovery. Before it can ship, its
dedicated POST-body contract must disable or redact request-body capture at the
edge, WAF, reverse proxy, APM, tracing, and error-reporting layers; keep the full
address out of application URLs, logs, analytics, durable challenge/session
state, and other application storage; and separately review and disclose that
the resulting provider authorization URL exposes the hint to the IdP and the
browser. Those controls require infrastructure verification, not only
application logger tests. If any layer cannot suppress capture, the hint is
omitted.

Existing `organizationId`, `connectionId`, and `slug` inputs remain temporarily
available for invitation, admin-shared link, and compatibility entrypoints;
they do not bypass connection, callback-email allowlist, membership, or JIT
checks. A verified routing-domain claim is required only to select a connection
from an email domain. Explicit organization, connection, slug, and invitation
entrypoints may work without a routing claim while their connection is enabled
and tested.

### User flow

| State | Presentation | Allowed transitions |
| --- | --- | --- |
| `methods_loading` | Stable auth shell and progress label. No speculative buttons. | Manifest success to `methods_ready`; failure to `methods_error`. |
| `methods_ready` | GitHub, Google, SSO in manifest order. | Provider start, `sso_email`, or local continuation on Desktop. |
| `sso_email` | One labeled work-email field, Back, and Continue. ProductClient retains it only in memory, extracts the domain locally, and discards the full address when the transaction ends. | Valid domain submit to `sso_discovering`; Back to methods. |
| `sso_discovering` | Field disabled and an announced progress status. | Match to `sso_ready`; generic miss to recoverable inline error; rate limit to retry state. |
| `sso_ready` | Generic `Continue with SSO` with Back available. | Start to `redirecting`; Back clears the discovery token. |
| `redirecting` | Provider handoff status and Cancel when transport permits. | External provider, cancel, or start failure. |
| `callback_processing` | One-shot callback status. No method chooser is mounted concurrently. | Authenticated, `link_required`, membership recovery, or terminal retry. |
| `link_required` | Explain that an account already exists and require sign-in with an existing global method before linking. Do not name providers that are not already safe to disclose. | Global auth to explicit link confirmation; cancel to methods or support recovery. |
| `authenticated` | Global product entry for GitHub/Google; locked target-organization entry for organization SSO. | Product or organization route. |

Unknown-domain copy is generic: `We couldn't find SSO for that work email.
Check the address or use another sign-in method.` It must not distinguish a
missing organization, unverified domain, disabled connection, or policy state.

Slug URLs and invitation URLs supply explicit organization context and converge
on the same redirect, callback, error, binding, and session rules. The current
thin-Web `/join/{organizationId}` route attempts organization SSO and falls back
to the Desktop deep link after any discovery or start failure; narrowing that
fallback to classified non-SSO outcomes would be a separate behavior change.

## Identity creation and account linking

Provider subject, not email, is the durable login key. Preserve the existing
normalized database keys: `(provider, provider_subject)` for fixed
GitHub/Google/Apple providers and `(connection_key, provider_subject)` for every
SSO identity. Organization SSO uses
`connection_key="organization:<connection UUID>"`. Env-backed deployment SSO
uses the stable `connection_key="deployment"`, has `id=None`, and has no
`sso_connection` database row. `connection_id` is therefore optional
organization-row metadata, never the SSO identity namespace; the implementation
must not fabricate a deployment UUID.

The callback still validates the exact canonical issuer and audience bound into
its one-time challenge. GitHub, Google, and Apple each have one fixed canonical
issuer namespace. An organization SSO connection's issuer or tenant cannot
change in place after identities exist: the admin creates and tests a new
connection UUID, which produces a new connection key and identity namespace.
Deployment SSO cannot reinterpret subjects from a new issuer, tenant, audience,
or protocol under the stable `deployment` key. Such a namespace replacement
fails closed until an explicit audited operator reset is approved and executed.
That reset revokes outstanding deployment challenges and session families,
moves old deployment bindings out of the active `sso_identity` namespace into
an immutable audit/archive, and requires collision-safe relinking through the
same explicit-link rules as a new identity. It never rebinds by email.

Database unique constraints own both identity-key uniqueness and one-user
binding. Callback, user creation, and pending-link creation form one atomic
callback-resolution transaction. The later user-confirmed binding is a
separate atomic transaction. Both use row locks or constraint-conflict handling
so concurrent callbacks or confirmations cannot create two users or rebind a
subject. Apply the same decision table to GitHub, Google, and organization SSO:

| Callback result | Required outcome |
| --- | --- |
| Provider/connection subject is already bound | Sign in the bound user after all challenge and provider checks pass. |
| Subject is unbound and verified email is unclaimed | Create a user only if that method's signup, invitation, or JIT policy allows it, then bind the subject. |
| Subject is unbound and verified email belongs to an existing user | Do not attach, merge, or sign in by email. Create a short-lived pending-link challenge and require authentication to the existing account followed by explicit confirmation. |
| Globally authenticated user deliberately starts `link` | Bind only after a recent-auth check, one-time state/PKCE validation, email/policy checks, and an explicit confirmation naming both identities. An organization- or deployment-scoped session must first establish a global session. |
| Subject is already bound to a different user | Reject with `auth_identity_already_linked`; never move the identity in the callback. |
| Organization SSO user lacks an invitation, active membership, or permitted JIT policy | Reject with the existing stable membership/JIT family of errors and do not create or bind anything. |

A verified routing domain proves which connection should handle an email; it
does not prove that the IdP may take over a pre-existing Proliferate account.
An invitation also grants organization membership, not global account
ownership. These facts never bypass the explicit-link rule.

Pending-link challenges contain only server-side or encrypted references, are
single-use, expire within ten minutes, and are bound to original surface,
provider subject, intended user, and purpose. The user must establish a global
session with an already-bound GitHub, Google, or permitted password method;
authenticating again with the colliding new identity or with an organization-
or deployment-scoped SSO session cannot satisfy the challenge. An account with
no usable global method enters support-owned recovery rather than relaxing the
binding rule.

The durable pending-link record contains an opaque id, a hash of the client
handle, intended user id, normalized identity key, encrypted callback identity
facts needed to finish the bind, surface, purpose, status
(`pending`, `confirmed`, `cancelled`, or `expired`), creation time, and expiry.
It never stores provider access or refresh tokens. The provider callback and
normal host callback exchange return one of:

```json
{ "status": "authenticated", "session": "surface-specific session result" }
{ "status": "link_required", "linkToken": "opaque-body-only-value", "expiresIn": 600 }
{ "status": "error", "code": "stable_error_code", "correlationId": "opaque-id" }
```

`linkToken` appears only in an exchange/start request or response body, never an
HTTPS location, deep link, log, or telemetry event. Starting
`purpose=global_reauthentication` submits the token in the provider-start body;
the server binds the pending-link id to that one-time OAuth challenge. Web may
retain only the PKCE verifier in tab-scoped session storage across the full-page
redirect. The successful reauthentication callback exchange returns a rotated
body-only `linkToken`, so the original handle need not survive in client memory.
A global session completes or cancels the challenge through:

```http
POST /auth/identity-links/confirm
{ "linkToken": "opaque-body-only-value" }

POST /auth/identity-links/cancel
{ "linkToken": "opaque-body-only-value" }
```

Confirmation verifies that the global session user is the intended user and
that its `auth_time` is after challenge creation and inside the ten-minute
recent-auth window. It rechecks identity uniqueness and provider/SSO policy,
then atomically binds and consumes the challenge. Cancel and expiry are
terminal. A constraint race returns `auth_identity_already_linked` without
changing either account.

OAuth identity and service authorization are separate consent purposes. A
Google sign-in callback requests and retains only the verified identity facts
needed for login; a distinct integration consent is required before requesting
or retaining Google API grants. Existing provider-grant data migration is not a
prerequisite for the visible method-set rollout.

### SSO connection revision and audit

Every SSO namespace has durable security-control state keyed by
`connection_key`, not by nullable `connection_id`. That state carries a
monotonic `security_revision`, current status, a non-secret namespace
fingerprint, and timestamps. Organization connections may additionally point to
their database UUID. Deployment SSO reconciles its env-backed configuration
against the `deployment` control record before accepting a challenge or refresh;
it remains auditable without pretending that an `SsoConnection` row exists.

Creating a challenge or discovery grant snapshots the accepted connection key
and revision. Session mint snapshots the same pair. A security-relevant
configuration or authority change advances the revision transactionally and
invalidates unconsumed challenges and discovery grants. Disabling, deleting, or
explicitly security-revoking a connection also revokes every active family for
that connection key. Display-label-only edits do not advance the security
revision. A namespace-fingerprint change follows the stricter replacement rule
above and cannot be approved as an ordinary revision bump. A same-namespace
client-secret or endpoint rotation may retain identity bindings, but it is
audited, advances the security revision, and invalidates old in-flight artifacts
and families.

At callback, the server reloads connection control by key, requires the
challenge revision to equal the current enabled revision, and only then resolves
the provider subject. Missing, disabled, revoked, or mismatched state fails
closed before identity lookup or session mint.

An append-only audit stream records connection key, revision, event, reason,
actor or deployment provenance, opaque correlation id, timestamp, non-secret
old/new fingerprints, and redacted changed-field names. It may record an
organization connection UUID when one exists. It never records provider
subjects, DNS proof tokens, client secrets, IdP tokens, raw discovery domains,
or full emails.

## Session and authorization scope

Every newly minted session family has:

- an opaque `session_id`;
- `surface` (`web`, `desktop`, or compatibility `mobile`);
- `auth_method` (`github`, `google`, `organization_sso`,
  `deployment_sso`, compatibility `apple`, or operational `password`);
- `scope` (`global`, `organization`, or `deployment`);
- `organization_id` when scope is `organization`;
- required `sso_connection_key` and `sso_connection_revision` when the method is
  organization or deployment SSO, null for non-SSO methods;
- `auth_time`, creation, rotation, expiry, and revocation timestamps; and
- a hashed, rotating refresh credential. Raw refresh credentials are never
  stored server-side.

The SSO family key is the same durable namespace used by the identity and
challenge. An organization family may retain its organization connection UUID
as non-authoritative query metadata, but access, audit, refresh, and revocation
key on `sso_connection_key` plus the accepted revision. A deployment family
uses `sso_connection_key="deployment"`; no nullable or synthetic database
identity stands in for it.

Each host has one active credential family at a time, although the server may
retain other device families. A link or reauthentication transaction is
secondary state bound to the initiating family and cannot overwrite or widen
that family before successful confirmation. On successful global
reauthentication, Web atomically replaces its active cookie family and Desktop
atomically replaces its secure stored family; failure or cancellation leaves
the initiating family unchanged. A link started from an existing global
session adds the identity without replacing that session.

Access tokens carry the session id, method, and scope needed for fail-closed
authorization. Server authorizers also load current session and connection
control state so accepted-revision mismatch, connection, membership, user, or
session revocation takes effect without waiting for the longest refresh
lifetime. Routing-domain claim state is not session authority: claim revocation
affects discovery artifacts only, as specified below.

| Authentication result | Scope | Authority |
| --- | --- | --- |
| GitHub or Google | `global` | The user's personal product resources and organizations allowed by membership. GitHub-specific operations still require a usable GitHub grant. |
| Organization SSO | `organization` | The named organization and minimum bootstrap/reauthentication/logout routes. It cannot select personal ownership, confirm a global account link, access another organization, administer unrelated global account state, or qualify as authority for a different org. |
| Deployment SSO | `deployment` | Resources permitted by the deployment's configured tenancy policy. It is not silently treated as a hosted global identity. |
| Operational password | Existing deployment policy | No new hosted public-password behavior is introduced. |

An organization-scoped user who selects a personal resource or another
organization receives `organization_reauthentication_required`. The client
preserves the intended destination, asks for GitHub or Google, and resumes only
after a global session is established. Organization SSO never upgrades an
existing global session's authority merely because both belong to the same
user.

Organization scope is default-deny. Its explicit cross-organization allowlist
is limited to session bootstrap/viewer, refresh, current-session logout, and
provider start/callback routes whose purpose is
`global_reauthentication`. Those routes establish a separate global session;
the organization session cannot confirm a global account link. The scoped
viewer response exposes only the minimum user identity and target organization,
not unrelated memberships or resources. Target-organization APIs require a
matching `organization_id`. Every other personal-owner, other-organization,
billing, global account mutation, and administrative route rejects organization
scope unless its own authoritative contract adds a narrower exception.

Refresh locks the family, validates and consumes the presented refresh hash,
rechecks the user, scope, membership, connection status/key, and accepted
security revision, and rotates the hash atomically. It preserves the original
method, scope, organization, connection key/revision, surface, and family id and
cannot widen authority. Reuse of a consumed refresh credential or any failed
authority check fails closed. A consumed-credential replay revokes the affected
family and appends a security audit event; it never returns another refresh
credential.

Disabling or deleting an SSO connection, an explicit connection security
revocation, removing the membership, disabling the user, or revoking the
session prevents subsequent refresh and protected access. Connection-level
revocation finds families by `sso_connection_key`, including `deployment`, and
does not depend on a database connection UUID. Routing-domain revocation
invalidates new domain discovery and every unconsumed discovery token, but it
does not revoke an already-minted SSO session; connection and membership state
remain that session's authority. Slug/invitation sessions therefore need no
routing-claim provenance.

Web keeps access tokens in memory, the active PKCE verifier in tab-scoped
session storage, and refresh credentials in Secure, HttpOnly, SameSite cookies
with the existing CSRF double-submit protection. Callback completion clears the
tab-scoped transaction. Desktop keeps refresh credentials in OS-backed secure
storage and never places tokens in callback URLs. OAuth/OIDC state, nonce, PKCE
verifier, and callback challenge are surface-bound, single-use, and
expiry-checked. Web uses an allowlisted HTTPS callback; Desktop uses the
registered deep link only to deliver an opaque authorization result which the
app exchanges server-side.

Ordinary `Sign out` revokes the current session family. Desktop immediately
clears its secure stored credential even when the network request fails. Web
immediately clears memory state and writes a non-secret, origin-wide signed-out
tombstone that suppresses refresh in every tab. Because JavaScript cannot clear
an HttpOnly cookie while offline, Web retries the same-origin logout when
connectivity returns; that response revokes the family, expires the cookie, and
clears the tombstone. A boot with a tombstone never refreshes first. `Sign out
all devices`, password change, user disable, and a security response may retain
the user-wide token-generation/revoke-all mechanism. A current-session logout
must not silently sign out unrelated devices.

## Error and recovery contract

| Condition | Stable client state | Recovery |
| --- | --- | --- |
| Method manifest unavailable | `methods_error` | Retry; Desktop may continue locally. Do not guess methods. |
| Provider disabled between manifest and start | `auth_methods_changed` | Refetch manifest and announce the changed options. |
| Unknown/unverified/disabled SSO domain | `sso_not_available` | Keep email editable; offer GitHub and Google. |
| Discovery throttled | `sso_discovery_rate_limited` | Generic wait-and-retry copy; do not reveal whether the domain exists. |
| User cancels provider | `auth_cancelled` | Return focus to the method that launched the flow. |
| State, nonce, PKCE, token, or callback expired/reused | Existing stable callback error family | Clear the transaction and offer a fresh start; never auto-replay. |
| Existing-account collision | `auth_account_link_required` | Establish a global session through an existing method, confirm, and consume the pending-link challenge; otherwise use support recovery. |
| Identity bound elsewhere | `auth_identity_already_linked` | Stop; direct the user to support/account recovery. |
| SSO invite/JIT/membership denied | Existing stable SSO policy code | Explain invite/admin action without exposing other organization data. |
| Organization session leaves its scope | `organization_reauthentication_required` | Global reauthentication with GitHub or Google, then resume the intended route. |
| Web beta denied | Existing Web beta state | Keep the existing policy-specific Desktop handoff; do not mislabel it as provider failure. |

Error URLs and deep links carry stable codes and opaque correlation ids only,
never emails, domains, tokens, IdP responses, organization ids, or connection
ids. Retrying creates a new transaction rather than reusing consumed state.

## Telemetry and operations

ProductClient emits this shared low-cardinality event surface:

```text
auth_methods_viewed
auth_method_started
auth_method_result
auth_sso_discovery_result
auth_link_started
auth_link_result
auth_session_scope_reauthentication
```

Allowed properties are `surface`, `method`, `purpose`, `outcome`, stable
`error_code`, and `session_scope`. Never capture email,
domain, organization or connection id/name, provider subject, callback URL,
authorization code, token, IdP payload, or free-form error text. Hosted vendor
capture follows the existing PostHog gate; first-party server metrics use only
the same low-cardinality dimensions.

Server operations expose counters for discovery outcome, verification outcome,
callback result, link result, scope rejection, refresh rejection, and logout
result. Structured logs use an opaque correlation id and hashed identifiers
only where operationally necessary. Alerts should cover callback failures,
identity-link conflicts, unexpected domain-claim conflicts, and organization
scope-rejection regressions without creating an account/domain enumeration
dashboard.

## Accessibility and interaction

- Every action has a visible text label; provider icons are decorative when
  adjacent text already names the method.
- Method order and keyboard order are identical. Back and retry actions return
  focus to the initiating control or invalid field.
- Discovery, redirect, callback, and error changes use an appropriately polite
  live region. Busy controls are disabled and retain their accessible name.
- Email uses a persistent label, `autocomplete="email"`, and an input mode
  suitable for email. Validation does not rely on color and does not claim a
  domain is unknown before the server responds.
- Reduced-motion preferences suppress nonessential auth transitions. The flow
  does not require a popup, pointer, hover, or time-limited manual action.
- Generic enumeration-safe copy remains specific enough to offer a next step.

## Rollout and compatibility

If this proposal is accepted and promoted, ship it in these reviewable
checkpoints. Schema and server policy may land dark, but scoped-session
enforcement and domain discovery stay off until the scope-aware clients and
activation gate in checkpoint 4 are deployed.

1. **Trust and authority foundation.** Add verified routing-domain storage and
   admin APIs, explicit identity-collision challenges, session ids/scopes, and
   fail-closed organization authorization behind a dark enforcement flag.
   Import existing allowed domains as pending. Add migration and negative tests
   without changing visible methods or legacy session behavior.
2. **Server contracts.** Add the hosted method manifest, domain-only POST
   discovery, opaque discovery token, connection-key revisions/audit,
   per-session refresh/revocation, and stable recovery codes. Keep old start
   inputs for invitation and slug compatibility. Accept but do not yet require a
   versioned client-capability marker.
3. **Shared ProductClient flow.** Implement the common method chooser, Google
   login, domain-first SSO state machine, callback/link recovery, telemetry, and
   accessibility behavior. Web and Desktop hosts implement only their
   transport/storage adapters and advertise `authContractVersion=2` only after
   they can bootstrap, refresh, recover, and log out scoped families.
4. **Capability-gated activation.** Deploy the updated thin-Web auth adapter and
   set a minimum supported Desktop version. Atomically enable scoped-session
   enforcement only for `authContractVersion=2`. An older Desktop or stale Web
   bundle receives `auth_client_update_required` before a challenge or session
   is created; the server never falls back to a global SSO session or returns a
   scoped credential that client cannot consume. Only after this gate is proven
   may the legacy stateless credentials be rejected on refresh.
5. **Admin verification and guarded enablement.** Surface DNS verification,
   connection/domain status, and revoke/rotate controls. Enable discovery for
   internal and selected customer domains behind a server flag; compare
   discovery, callback, link, and scope-rejection metrics.
6. **Hosted parity rollout.** Enable the GitHub/Google/SSO set for Desktop and
   Web cohorts, verify callback allowlists and deep links in production, then
   make it the hosted default. Retain slug and invitation links.
7. **Compatibility cleanup.** Remove ProductClient's old probe composition and
   the Web host's static anonymous method list after the manifest-driven shared
   flow is live. Self-managed clients retain current behavior pending their own
   accepted contract.

Existing provider and SSO subject bindings remain valid. An unscoped legacy
credential may be exchanged only when durable server-side provenance proves
its auth method and, for SSO, its organization, connection key, and accepted
revision. The evidence baseline's stateless refresh credentials contain no such
provenance, so they are rejected at the session-family checkpoint and require a
one-time normal sign-in; linked identities remain intact. A future pre-rollout
credential backed by complete durable provenance may be exchanged, but missing
or ambiguous provenance always fails closed. An unscoped SSO credential is
never inferred to be global from the user's linked identities. No existing
`allowed_domains` row becomes discoverable without DNS verification.

The session-family migration represents existing Mobile and Apple sessions
with the compatibility enum values above without changing Mobile's visible
method set or storage behavior. That compatibility is schema preservation, not
a Mobile redesign.

Each checkpoint has an independent rollback switch. Rolling back a client does
not disable server-side collision or scope enforcement. Revoking domain
discovery leaves explicit slug/invitation SSO available when the connection is
otherwise safe.

## Acceptance tests

The implementation is complete only when automated tests cover:

1. Hosted Desktop and Web render GitHub, Google, and SSO in the same order from
   the manifest; neither renders Apple or password.
2. Hosted Desktop and Web never render Apple or password. Direct
   `purpose=login` calls to those methods, or to any hosted method omitted by
   current policy, are rejected server-side without creating a challenge;
   separately authorized link/integration purposes cannot mint a login session.
3. Manifest failure renders retry rather than a guessed method set.
4. Pending, revoked, conflicting, malformed, public-suffix, unverified, and
   disabled routing domains never discover; one DNS-verified unique domain
   does. Duplicate valid allowed domains migrate as independent expiring
   pending contenders, invalid values create audit warnings but no claims, and
   the first serialized DNS proof wins without a migration-selected owner.
5. Unknown, unverified, disabled, and nonexistent SSO configurations have the
   same public response shape and UI copy. Discovery accepts exactly `{domain}`;
   schema tests reject email, local-part, and surface fields, and server/edge/WAF/
   APM evidence proves that no domain or full address is captured in URLs, logs,
   traces, metrics, or analytics.
6. A discovery token is surface-bound, purpose-bound, single-use, expires, and
   fails after domain revocation, connection revocation, or security-revision
   change.
7. GitHub and Google complete on Web through the HTTPS callback and on Desktop
   through system browser plus deep link. Wrong-surface, wrong-state,
   wrong-PKCE, expired, and replayed callbacks fail closed.
8. A new unclaimed provider subject can create an eligible account. A verified
   email collision cannot sign in or attach until the existing account is
   authenticated and explicit linking succeeds. The same negative applies to
   organization SSO, even for an invited email or verified routing domain. The
   link token is body-only, single-use, intended-user bound, and confirm/cancel/
   expiry outcomes are terminal under concurrent callback tests. Global
   reauthentication binds the challenge server-side across a full-page
   redirect, rotates the body-only token on return, and requires fresh
   `auth_time`.
9. Invitation/JIT policy is checked before an SSO user or membership is
   created; denial leaves no user, membership, identity, or session residue.
10. Organization SSO can access its target organization but cannot access
    personal resources, another organization, or global admin/account routes.
    Reauthentication with GitHub or Google resumes a preserved destination.
11. Refresh rotation atomically consumes the old hash and preserves family id,
    method, scope, organization, connection key/revision, and surface. Replay or
    a stale connection revision fails closed. Current-session logout revokes
    only that family; connection revocation finds every affected SSO family by
    connection key; sign-out-all revokes every user family. Desktop secure
    storage clears immediately on local logout failure. Web suppresses all
    refresh with an origin-wide tombstone, then revokes the family and expires
    the HttpOnly cookie on the next reachable same-origin response.
12. Google and valid organization SSO users enter the product without a global
    Connect GitHub gate; a GitHub-dependent feature still requests GitHub at
    point of use.
13. `/login/<slug>` and `/join/{organizationId}` converge on the same callback,
    linking, scope, and recovery behavior as domain-first SSO. The current join
    route's Web-SSO attempt and Desktop fallback on discovery/start failure are
    preserved unless a separate behavior contract changes that classification.
14. Keyboard-only and screen-reader tests cover method selection, invalid
    email, discovery progress, provider return, error recovery, and focus
    restoration. Reduced-motion mode removes nonessential transitions.
15. Telemetry schema tests reject raw email, domain, ids, subjects, URLs,
    tokens, and free-form error text on every auth event.
16. A legacy credential exchanges only with complete durable method/scope
    provenance. Evidence-baseline stateless credentials require one-time
    sign-in, and a legacy organization SSO credential can never become a global
    family by inference.
17. Session-family schema and migration preserve Mobile and Apple sessions
    without making Apple visible on Desktop/Web or changing Mobile behavior.
18. Before capability activation, old clients retain legacy behavior. After
    activation, an unsupported Desktop/Web client receives
    `auth_client_update_required` before challenge/session minting; no path
    downgrades organization SSO to global scope, and domain discovery remains
    disabled until the version gate is active.
19. SSO identities, challenges, and session families use
    `(connection_key, provider_subject)` and connection-key/revision provenance.
    Organization keys are `organization:<UUID>`; deployment uses `deployment`
    with no connection row or synthetic UUID. Deployment namespace replacement
    fails closed pending the explicit audited reset/migration policy.

Run focused Server unit/integration tests, shared ProductClient component tests,
both host-adapter tests, and end-to-end provider/SSO intent journeys. Production
qualification must exercise the actual Web callback allowlist and installed
Desktop deep-link registration in addition to mock-provider tests. Any later
login-hint flow also requires deployed edge/WAF/APM body-capture verification.

## Unresolved acceptance decisions

This checklist is intentionally unresolved while the proposal is a draft. It
must not be converted into checked boxes without explicit founder/security
acceptance recorded in the PR.

Founder acceptance:

- [ ] Approve the hosted method set and order: GitHub, Google, then customer SSO;
  keep Apple and password out of the hosted chooser.
- [ ] Approve Google and valid organization SSO as product-ready identities,
  moving GitHub enforcement to features and credit policy that actually need it.
- [ ] Approve the scope boundary: hosted Desktop and hosted Web only, with
  self-managed Desktop unchanged and self-managed Web deferred.
- [ ] Approve one-time sign-in for legacy stateless credentials that lack durable
  method, scope, connection-key, and revision provenance.
- [ ] Approve preserving the current invitation behavior in which any Web SSO
  discovery/start failure falls back to Desktop, or require a separately scoped
  classification change before implementation.

Security acceptance:

- [ ] Accept domain-level SSO participation leakage plus DNS proof-wins claims,
  expiring pending leases, periodic revalidation, and generic miss responses.
- [ ] Approve exact domain-only discovery, its network/domain rate limits, and
  the prohibition on sending a full email or IdP login hint in this target.
- [ ] Approve explicit collision linking, body-only handles, recent-auth
  confirmation, and support recovery when no existing global method is usable.
- [ ] Approve default-deny organization scope, the small bootstrap/
  reauthentication/logout allowlist, and point-of-use global reauthentication.
- [ ] Approve connection-key/revision session authority, append-only audit,
  scoped connection revocation, refresh replay handling, and per-family logout.
- [ ] Approve the explicit archive/reset and collision-safe relink behavior for
  an env-backed deployment SSO issuer/tenant/audience namespace replacement
  under the stable `connection_key="deployment"`.

## Explicit non-goals

- Mobile method redesign or removal of existing Apple identities.
- Self-managed Web discovery, callbacks, provider method decisions, or password
  behavior; self-managed Desktop chooser changes or password-fallback redesign.
- SAML, SCIM, passwordless email, passkeys, public password signup, password
  reset, or email verification.
- Sending a full email to discovery or adding an IdP login-hint flow; the latter
  requires a separate accepted security and infrastructure contract.
- Organization-wide mandatory-SSO policy or a hosted account-recovery redesign.
- Changing Web beta eligibility, free-credit anti-abuse policy, or GitHub's
  point-of-use requirements.
- Replacing organization invitations, JIT policy, or the organization slug
  model.
- ProductClient/host refactors or visual redesign outside the auth states
  defined here; the thin-host migration has already landed.
- Historical provider-grant schema cleanup beyond preventing the new Google
  sign-in purpose from requesting or retaining integration grants.
- Automatically trusting current `allowed_domains`, merging accounts by email,
  or treating an organization IdP as global account authority.
