# Onboarding

Status: authoritative for the current product onboarding read path.

Onboarding is the path from a signed-out person to a product-ready account that
can create or join useful work. It is not one component or one server route.
It spans product auth, provider readiness, billing/credits, agent auth, settings
handoff, and first workspace creation.

## Scope

Use this spec when changing:

- signed-out to signed-in handoff for Desktop, Web, or Mobile
- GitHub-required/product-readiness gates
- first-run account, team, billing, or provider setup states
- managed-credit or BYOK onboarding shown to a new user
- the transition from onboarding into first cloud workspace creation
- onboarding copy, analytics, QA, or support behavior

Out of scope:

- low-level account auth routes and password/provider semantics, owned by
  [Product Auth](../auth/README.md)
- server auth/resource-access structure, owned by
  [../../../structures/server/guides/auth.md](../../../structures/server/guides/auth.md)
- managed-credit, BYOK, and Bifrost data-plane contracts, owned by
  [../../../platforms/product/agent-auth-bifrost-byok.md](../../../platforms/product/agent-auth-bifrost-byok.md)
- billing authorization and Stripe subscription/refill behavior, owned by
  [../../../platforms/product/billing.md](../../../platforms/product/billing.md)
- managed workspace creation, owned by
  [../../../platforms/product/workspace-provisioning.md](../../../platforms/product/workspace-provisioning.md)

## Read Order

1. This spec for the end-to-end onboarding sequence and boundaries.
2. [Product Auth](../auth/README.md) for sign-in methods, linked providers,
   password accounts, reviewer accounts, and GitHub readiness.
3. [Settings and Admin Information Architecture](../settings/information-architecture.md) for where account, provider,
   billing, team, and configuration states appear.
4. [../../../platforms/product/agent-auth-bifrost-byok.md](../../../platforms/product/agent-auth-bifrost-byok.md)
   for managed credits, BYOK, Bifrost virtual keys, and gateway QA.
5. [../../../platforms/product/billing.md](../../../platforms/product/billing.md) for credit budgets,
   free allocations, Stripe checkout, refill, and billing state.
6. [../../../platforms/product/workspace-provisioning.md](../../../platforms/product/workspace-provisioning.md)
   and [Pending Workspace Shell](../workspaces/pending-shell.md) for first
   workspace creation and pending-shell handoff.

## Mental Model

Onboarding has four readiness layers:

```text
identity readiness
  user has an authenticated Proliferate account
provider readiness
  user has the required linked provider state, currently GitHub
run readiness
  billing/credits and agent auth can authorize and launch cloud work
workspace readiness
  user can create, claim, or open a workspace and send the first useful prompt
```

These layers are separate. A user may be signed in but not product-ready. A
user may be product-ready but blocked from managed cloud work by billing,
credits, agent auth, target configuration, or provider state. UI should name the
blocked layer instead of hiding the action or pretending the account is ready.

## Current Flow

The normal onboarding path is:

```text
1. User signs in through Desktop, Web, or Mobile.
2. Product auth creates or restores the Proliferate session.
3. Product readiness checks linked provider state.
4. If GitHub readiness is missing, the surface shows the GitHub-required path.
5. After provider readiness, account/settings surfaces show billing, team, and
   agent auth readiness.
6. Managed-credit or BYOK setup establishes cloud run readiness.
7. User starts first work through New Chat, Continue remotely, claim, Slack,
   automation, cowork, or API entrypoint.
8. Workspace creation uses the managed workspace provisioning path.
9. Pending shell remaps to durable workspace/session ids after creation.
10. First command or prompt proves onboarding by producing commandable work.
```

## Surface Ownership

| Surface | Onboarding responsibility |
| --- | --- |
| Desktop | Start GitHub-first sign-in, restore account state, show account/password/provider settings, expose Continue remotely/New Chat only through real readiness gates, and route first work through workspace provisioning. |
| Web | Support signed-out/sign-in handoff, provider readiness, cloud workspace creation/open/claim paths, billing/account settings, and staging/production smoke for first cloud work. |
| Mobile | Support mobile auth session restore, GitHub-required state, mobile cloud chat creation/opening, settings state, and native/mobile-web smoke for first work. |
| Server | Own account identity, linked provider state, billing/account readiness responses, agent auth/gateway capability state, and managed workspace launch services. |
| AnyHarness/Worker | Do not own onboarding UI; they surface runtime/commandability failures that onboarding surfaces must represent accurately. |

## Invariants

- GitHub remains the product-readiness provider until an explicit product-auth
  spec change says otherwise.
- A password-only user may be signed in but remains limited until GitHub
  readiness succeeds. Do not add hidden readiness bypasses for normal users.
- Onboarding surfaces must use server/account readiness and capability state;
  they must not infer readiness from local UI state alone.
- Managed-credit free allocations must be deduped through the billing/gateway
  primitives. UI copy must not promise credits that the server cannot grant.
- BYOK and managed-credit setup are cloud run readiness, not account identity.
- First workspace creation must go through
  [../../../platforms/product/workspace-provisioning.md](../../../platforms/product/workspace-provisioning.md);
  do not hand-roll first-workspace creation in an onboarding component.
- Billing, provider, and agent-auth blockers should preserve the user's typed
  prompt or intent when practical, then resume through the normal pending-shell
  or workspace creation path after readiness changes.

## Analytics And Support

Onboarding analytics must follow the
[Engineering Analytics contract](../../engineering/analytics/README.md):

- Use stable event names and scrubbed properties.
- Do not send prompts, repo names, raw file paths, request bodies, auth
  material, cookies, or secret values.
- Track readiness layer and blocker codes, not free-form user content.

Support reports and debugging should include stable ids when available: user
id, organization id, linked provider state, billing subject id, workspace id,
session id, command id, and support report id. Use
[../../../../developing/debugging/README.md](../../../../developing/debugging/README.md)
for the operator path.

## Verification

For onboarding changes, choose the narrowest useful matrix from
[../../../../developing/qa/README.md](../../../../developing/qa/README.md) and include the
touched surfaces.

Minimum local smoke for end-to-end onboarding changes:

```text
1. Start a clean dev profile.
2. Sign in through the changed surface.
3. Verify the GitHub-required state appears when provider readiness is missing.
4. Link or use a product-ready GitHub identity.
5. Verify account/settings readiness state.
6. Verify managed-credit or BYOK setup state when cloud run readiness changed.
7. Create or open first work through the changed entrypoint.
8. Confirm the pending shell remaps to durable workspace/session ids.
9. Send a prompt or command and confirm transcript/commandability updates.
```

Use `STRIPE=1` and [../../../../developing/local/stripe-local-testing.md](../../../../developing/local/stripe-local-testing.md)
when billing checkout, portal, subscription, refill, webhook, or credit behavior
is part of the onboarding change.
