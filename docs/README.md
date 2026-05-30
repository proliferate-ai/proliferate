# Proliferate Docs

Docs exist to make product work predictable: where UI, state, logic, runtime
behavior, and operating procedures live should be obvious before code changes.
Read the relevant spec before touching code in that area and update it in the
same PR when behavior or ownership changes.

## Top-Level Shape

```text
docs/
  README.md
  structures/   Folder rules, ownership boundaries, and code maps by system.
  primitives/   Reusable product/runtime concepts used by multiple features.
  features/     User-facing workflows and product surfaces.
  dev/          Local dev, release, deployment, analytics, and ops runbooks.
  tbd/          Docs that are intentionally not yet authoritative.
```

## Documentation Style

Authoritative docs describe the contract as operating law. Do not write
cleanup promises, tentative caveats, or "eventually" architecture inside
canonical guides and READMEs. If existing code violates a rule, name it as a
migration exception and state the canonical owner/rule directly.

## Where Things Go

| Folder | Owns | Start here |
| --- | --- | --- |
| `docs/structures/` | Folder decomposition, dependency direction, ownership rules, and code maps for each major system. | `docs/structures/frontend/README.md`, `docs/structures/anyharness/README.md`, `docs/structures/proliferate-worker/README.md`, `docs/structures/server/README.md`, `docs/structures/desktop-native/README.md`, `docs/structures/sdk/README.md` |
| `docs/primitives/` | Reusable product/runtime concepts: sandbox provisioning, workspace lifecycle, MCP/skills, agent auth, cloud commands, claiming, billing, model catalog, and related low-level contracts. | Read the primitive that owns the tables, command contracts, or runtime behavior you are changing. |
| `docs/features/` | Product workflows and surfaces built from primitives: onboarding, automations, Slack, dispatch, chat surfaces, workspace files, product MCPs, and settings/admin IA. | Read the feature spec for the user-facing workflow being changed, plus any primitive it depends on. |
| `docs/dev/` | How to run, verify, release, deploy, observe, and operate the repo. | `docs/dev/README.md`, `docs/dev/running-locally.md`, `docs/dev/ci-cd.md`, `docs/dev/reference/env-vars.yaml` |
| `docs/tbd/` | Material that should not be treated as current operating law yet. | Move a doc out of `tbd` only when it has a clear owner and canonical contract. |

## Current Read Map

| Area | Docs |
| --- | --- |
| Frontend apps and shared packages | `docs/structures/frontend/README.md`; focused guides under `docs/structures/frontend/guides/`; shared package rules in `docs/structures/frontend/packages/README.md`; feature specs under `docs/features/` |
| Desktop native / Tauri | `docs/structures/desktop-native/README.md`; sidecar and agent seed specs under `docs/structures/desktop-native/specs/` |
| AnyHarness runtime | `docs/structures/anyharness/README.md`; guides under `docs/structures/anyharness/guides/`; contract in `docs/structures/anyharness/contract.md`; active runtime specs under `docs/structures/anyharness/specs/` |
| Proliferate Worker | `docs/structures/proliferate-worker/README.md` |
| Server | `docs/structures/server/README.md`; focused guides under `docs/structures/server/guides/` |
| AnyHarness SDKs | `docs/structures/sdk/README.md` |
| Cloud provisioning, commands, auth, MCPs, billing, claiming | `docs/primitives/` |
| Product workflows and surfaces | `docs/features/` |
| Local dev, CI/CD, deployment, env vars, analytics, observability | `docs/dev/` |

## Spec Rules

- Every durable feature, primitive, and structure rule belongs in a spec.
- Start implementation by reading the relevant structure doc and primitive or
  feature spec.
- Align implementation with the spec before coding; do not add a separate
  "best practices pass" after the product plan is already set.
- Keep specs current in the same PR as the behavior they describe.
