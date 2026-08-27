# Onboarding

The path from a signed-out person to commandable work: sign-in, product readiness, harness install and agent-auth setup, and the first workspace. A **client composition surface** spanning the login page, the Home screen's onboarding cards, and the readiness gates other surfaces mount; it owns no account, credential, or workspace record.

| Section | Document |
| --- | --- |
| Account sign-in, linked providers, reviewer accounts | [../auth/README.md](../identity/accounts.md) |
| Agent auth setup and the ack-gated "setting up" step | [AGENT_AUTH.md](../agent_auth/README.md) |
| Harness distribution and install | [MODELS.md](../harnesses/launch-options.md) |
| Billing / credit readiness | [BILLING.md](../billing/deep-dive.md) |
| First workspace creation | `workspace-provisioning.md` (deleted with the cloud provisioning stack, cull part 2; successor: [environments/README.md](../environments/README.md)) |
| Organization join by invitation | [../organizations/invitations.md](../identity/invitations.md) |

## Purpose

Get a person from install to their first useful prompt with every blocked layer named. Readiness is layered and each layer is owned elsewhere; this surface sequences them and preserves the person's intent (typed prompt, chosen repo) across blockers.

```text
account identity      signed in (GitHub-first; password limited until GitHub readiness)
product readiness     linked provider state says the account may use the product
runtime readiness     a harness is installed and reconciled on this machine
agent auth readiness  the harness can authenticate (local CLI login, BYOK, or managed gateway)
cloud run readiness   billing/credits or BYOK permit managed cloud work (gated dark today)
workspace readiness   a workspace exists and the first prompt is commandable
```

## Owned state

| State | Holds | Code |
| --- | --- | --- |
| Auth-setup onboarding | Adopted harness kinds, the latched outcome of the ack-gated step | [auth-setup-onboarding-store.ts](../../../apps/packages/product-client/src/stores/agents/auth-setup-onboarding-store.ts) |
| Home draft + deferred launch | The first prompt draft and a launch deferred behind readiness | [home-draft-handoff-store.ts](../../../apps/packages/product-client/src/stores/home/home-draft-handoff-store.ts), [deferred-home-launch-store.ts](../../../apps/packages/product-client/src/stores/home/deferred-home-launch-store.ts) |
| Login redirect target | Where to land after sign-in | [login-redirect](../../../apps/packages/product-client/src/lib/domain/auth/login-redirect.ts) via `location.state` |

Auth session state itself is host-owned (`ProductHost.auth`); the product reads it and never holds the credential ([product-host.ts](../../../apps/packages/product-client/src/host/product-host.ts)).

## Public surface

- [`LoginPage`](../../../apps/packages/product-client/src/pages/LoginPage.tsx)
  → [`LoginScreen`](../../../apps/packages/product-client/src/components/auth/LoginScreen.tsx)
  with GitHub and password sign-in, "connect to server" (Desktop
  self-hosting), and the redirect callback screen.
- Gates other surfaces mount:
  [`AuthGate`](../../../apps/packages/product-client/src/components/auth/AuthGate.tsx),
  [`MinDesktopVersionGate`](../../../apps/packages/product-client/src/components/auth/MinDesktopVersionGate.tsx),
  [`UserPreferencesGate`](../../../apps/packages/product-client/src/components/app/UserPreferencesGate.tsx),
  and the Home screen's
  [`HomeOnboardingCards`](../../../apps/packages/product-client/src/components/home/screen/HomeOnboardingCards.tsx)
  (max three: auth-setup step, setup cards, readiness card).
- Entry routing:
  [use-product-entry-routing.ts](../../../apps/packages/product-client/src/hooks/app/lifecycle/use-product-entry-routing.ts)
  decides login vs. product on boot.

## Consumes

| Owning system | Contract | Where |
| --- | --- | --- |
| Host auth (Desktop/Web) | `ProductHost.auth` state, GitHub and password sign-in transports | [use-login-page.ts](../../../apps/packages/product-client/src/hooks/auth/facade/use-login-page.ts), [use-github-sign-in.ts](../../../apps/packages/product-client/src/hooks/auth/workflows/use-github-sign-in.ts), [use-password-sign-in.ts](../../../apps/packages/product-client/src/hooks/auth/workflows/use-password-sign-in.ts) |
| Product auth (Cloud) | readiness, linked providers, min-version | [use-product-auth.ts](../../../apps/packages/product-client/src/hooks/auth/facade/use-product-auth.ts), [auth-probes.ts](../../../apps/packages/product-client/src/lib/access/cloud/auth-probes.ts) |
| Runtime agent catalog (`agents`) | install state, reconcile job snapshot (the live install source for the readiness card) | [use-home-installation-readiness.ts](../../../apps/packages/product-client/src/hooks/home/derived/use-home-installation-readiness.ts), `useAgentReconcileStatusQuery` |
| Agent auth + gateway (Cloud `auth`, `agent-gateway`) | first-run adoption posts selections; the setting-up step polls `applied` acks at 3 s for a ~20 s grace window, then auto-advances | [use-first-run-auth-adoption.ts](../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-first-run-auth-adoption.ts), [use-auth-setup-onboarding-step.ts](../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-auth-setup-onboarding-step.ts) |
| Desktop worker enrollment (Cloud `desktop-workers`) | on every authenticated Desktop boot, enroll a dispatch worker for this install under the active organization, with a bounded retry guard; the enrollment carries the integration-gateway identity dotfile that local sessions use | [use-desktop-worker-enrollment.ts](../../../apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts), [ensure-desktop-worker.ts](../../../apps/packages/product-client/src/lib/workflows/cloud/ensure-desktop-worker.ts) |
| Launch options (runtime-observed) | Home target picker and model selection before any session exists | [use-home-target-agent-launch-options.ts](../../../apps/packages/product-client/src/hooks/home/derived/use-home-target-agent-launch-options.ts) |
| Workspace surface | first workspace creation and the pending shell | [use-home-next-launch.ts](../../../apps/packages/product-client/src/hooks/home/workflows/use-home-next-launch.ts) → [../workspaces/README.md](../workspaces/README.md) |

## Laws

- **GitHub is the product-readiness provider.** A password-only user is
  signed in but limited until GitHub readiness succeeds; no hidden bypass
  ([../auth/README.md](../identity/accounts.md)).
- **Readiness is server state, never inferred locally.** Every gate reads
  account/capability state from the host or Cloud; the install card reads
  the runtime's reconcile snapshot, not a stale agent list
  ([use-home-installation-readiness.ts](../../../apps/packages/product-client/src/hooks/home/derived/use-home-installation-readiness.ts)).
- **Setup never hard-blocks the first prompt.** The auth-setup step
  auto-advances after its grace window and the harness pane's ordinary
  pending indicator carries on; both outcomes latch so the card never
  resurrects on a later manual edit.
- **Intent survives blockers.** The Home draft and deferred launch persist
  across a readiness change and resume through the normal launch path
  ([use-home-deferred-launch-runner.ts](../../../apps/packages/product-client/src/hooks/home/lifecycle/use-home-deferred-launch-runner.ts)).
- **First workspace goes through provisioning.** Onboarding components
  never hand-roll creation (`workspace-provisioning.md` — deleted with the
  cloud provisioning stack, cull part 2; successor:
  [environments/README.md](../environments/README.md)).
- **Managed-credit copy promises nothing the server cannot grant.**
  Allocations dedupe through billing/gateway primitives
  ([BILLING.md](../billing/deep-dive.md)).

## Emits

- Sign-in success → navigation to the redirect target.
- Adopted selections → agent gateway (first-run adoption).
- Analytics per the [analytics contract](../../engineering/observability/analytics.md):
  readiness layer and blocker codes only — never prompts, repo names, paths,
  auth material.
- Support-report ids (user, organization, provider state, workspace,
  session) per [guides/debugging](../../../guides/debugging/README.md).

## Fences

- **Product auth** owns identity, providers, reviewer accounts, and the
  auth surfaces' UX ([../auth/README.md](../identity/accounts.md)).
- **Settings** owns where the person returns to change what onboarding set
  ([../settings/README.md](../settings/README.md)).
- **Agent auth / models** owns selections, enrollment, install semantics.
- **Workspace surface** owns the Home target picker's launch into a
  workspace and everything after ([../workspaces/README.md](../workspaces/README.md)).
- **Hosts** (Desktop/Web) own auth transport, storage, and vendor bootstrap
  ([web-desktop-unification](../desktop-host/web-desktop-unification.md)).

## Code map

```text
apps/packages/product-client/src/
├── host/product-host.ts                     auth state + storage contract the surface reads
├── lib/access/cloud/auth-probes.ts · auth-transport.ts
├── domain/auth/{model,rules,presentation}.ts     PURE (shared with Mobile)
├── lib/domain/auth/                         login redirect, auth mode
├── lib/workflows/auth/apply-auth-state.ts · lib/workflows/agents/first-run-auth-adoption.ts
├── lib/workflows/cloud/ensure-desktop-worker.ts
├── hooks/auth/{facade,workflows}/           login page, product auth, sign-in flows
├── hooks/app/lifecycle/use-product-entry-routing.ts
├── hooks/agents/lifecycle/                  first-run adoption, auth-setup step + evidence
├── hooks/home/{derived,ui,workflows,lifecycle}/   readiness card, target picker, launch, deferred launch
├── stores/agents/auth-setup-onboarding-store.ts · stores/home/
├── components/auth/                         LoginScreen, gates, callback, connect-server
├── components/home/screen/                  HomeNextScreen, onboarding cards, target picker
├── copy/auth/ · copy/home/
└── pages/LoginPage.tsx · pages/MainPage.tsx (Home)
```

## Proof

- Unit: `lib/domain/auth` (8), `hooks/agents` lifecycle tests, and
  [HomeNextScreen.test.tsx](../../../apps/packages/product-client/src/components/home/screen/HomeNextScreen.test.tsx)
  (home composer, target persistence, attachment battery).
- Login budget: CI "Login first-load budget (phase-6)" runs
  `scripts/measure-login-runtime-budget.mjs` against a real build.
- Server: auth-flow integration suite (`tests/integration/test_auth_flow*`).
- Manual smoke, minimum for end-to-end onboarding changes:

  ```text
  1. Start a clean dev profile.
  2. Sign in through the changed surface.
  3. Verify the GitHub-required state appears when provider readiness is missing.
  4. Link or use a product-ready GitHub identity.
  5. Verify the harness install / auth-setup cards resolve on Home.
  6. Create or open first work through the changed entrypoint.
  7. Confirm the pending shell remaps to durable workspace/session ids.
  8. Send a prompt and confirm the transcript updates.
  ```

  Use `STRIPE=1` and
  [stripe-local-testing.md](../../../guides/local/stripe-local-testing.md)
  when billing checkout, portal, refill, or credit behavior is part of the
  change; the fuller matrix is in
  [manual-release-qa.md](../../../guides/deploying/manual-release-qa.md).

## Known gaps / follow-ups

- Cloud run readiness (managed credits / BYOK for cloud work) is gated dark
  with the cloud lane; the layer stays in the ladder because the
  environments rebuild reintroduces it.
- Desktop worker enrollment runs unconditionally on every authenticated
  boot; it is the seam that will carry the future runtime worker identity
  and should move to the seam client system when that lands.
- Mobile onboarding shares only `domain/auth` and has no client spec.
