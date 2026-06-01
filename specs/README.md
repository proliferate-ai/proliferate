# Proliferate Specs

Specs exist to make product work predictable: where UI, state, logic, runtime
behavior, and operating procedures live should be obvious before code changes.
Read the relevant spec before touching code in that area and update it in the
same PR when behavior or ownership changes.

## Top-Level Shape

```text
specs/
  README.md
  codebase/
    structures/   Folder rules, ownership boundaries, and code maps by system.
    primitives/   Reusable product/runtime concepts used by multiple features.
    features/     User-facing workflows and product surfaces.
  developing/     Local dev, release, deployment, analytics, QA, and ops runbooks.
  tbd/            Specs that are intentionally not yet authoritative.
```

## Documentation Style

Authoritative docs describe the contract as operating law. Do not write
cleanup promises, tentative caveats, or "eventually" architecture inside
canonical guides and READMEs. If existing code violates a rule, name it as a
migration exception and state the canonical owner/rule directly.

## Where Things Go

| Folder | Owns | Start here |
| --- | --- | --- |
| `specs/codebase/structures/` | Folder decomposition, dependency direction, ownership rules, and code maps for each major system. | `specs/codebase/structures/frontend/README.md`, `specs/codebase/structures/anyharness/README.md`, `specs/codebase/structures/proliferate-worker/README.md`, `specs/codebase/structures/proliferate-supervisor/README.md`, `specs/codebase/structures/server/README.md`, `specs/codebase/structures/desktop-native/README.md`, `specs/codebase/structures/sdk/README.md` |
| `specs/codebase/primitives/` | Reusable product/runtime concepts: sandbox provisioning, workspace lifecycle, MCP/skills, agent auth, cloud commands, claiming, billing, model catalog, and related low-level contracts. | Read the primitive that owns the tables, command contracts, or runtime behavior you are changing. |
| `specs/codebase/features/` | Product workflows and surfaces built from primitives: onboarding, automations, Slack, dispatch, chat surfaces, workspace files, product MCPs, and settings/admin IA. | Read the feature spec for the user-facing workflow being changed, plus any primitive it depends on. |
| `specs/developing/` | How to run, verify, release, deploy, observe, and operate the repo. | `specs/developing/README.md`, `specs/developing/local/README.md`, `specs/developing/deploying/ci-cd.md`, `specs/developing/reference/env-vars.yaml` |
| `specs/tbd/` | Material that should not be treated as current operating law yet. | Move a doc out of `tbd` only when it has a clear owner and canonical contract. |

## Current Read Map

| Area | Docs |
| --- | --- |
| Frontend apps and shared packages | `specs/codebase/structures/frontend/README.md`; focused guides under `specs/codebase/structures/frontend/guides/`; shared package rules in `specs/codebase/structures/frontend/packages/README.md`; feature specs under `specs/codebase/features/` |
| Desktop native / Tauri | `specs/codebase/structures/desktop-native/README.md`; sidecar and agent seed specs under `specs/codebase/structures/desktop-native/specs/` |
| AnyHarness runtime | `specs/codebase/structures/anyharness/README.md`; guides under `specs/codebase/structures/anyharness/guides/`; contract in `specs/codebase/structures/anyharness/contract.md`; active runtime specs under `specs/codebase/structures/anyharness/specs/` |
| Proliferate Worker | `specs/codebase/structures/proliferate-worker/README.md`; focused guides under `specs/codebase/structures/proliferate-worker/guides/` |
| Proliferate Supervisor | `specs/codebase/structures/proliferate-supervisor/README.md` |
| Server | `specs/codebase/structures/server/README.md`; focused guides under `specs/codebase/structures/server/guides/` |
| AnyHarness SDKs | `specs/codebase/structures/sdk/README.md` |
| Cloud provisioning, commands, auth, MCPs, billing, claiming | `specs/codebase/primitives/` |
| Product workflows and surfaces | `specs/codebase/features/`; `specs/codebase/features/support-reporting.md` for Desktop support report uploads |
| Local dev, CI/CD, deployment, env vars, analytics, observability | `specs/developing/` |

## Spec Rules

- Every durable feature, primitive, and structure rule belongs in a spec.
- Start implementation by reading the relevant structure doc and primitive or
  feature spec.
- Align implementation with the spec before coding; do not add a separate
  "best practices pass" after the product plan is already set.
- Keep specs current in the same PR as the behavior they describe.
