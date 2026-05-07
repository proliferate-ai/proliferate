# Proliferate Docs

This repo includes both:

- implementation docs for Proliferate itself
- implementation docs for AnyHarness itself
- design/reference research snapshots

Read the relevant area doc before touching code in that area. Do that at the
start of the task, not after implementation has already started.

## Authoritative frontend standards

- `docs/frontend/README.md`
  - start here for frontend ownership, dependency direction, guides, and specs
- `docs/frontend/guides/components.md`
  - component ownership, UI primitive usage, and component folder hierarchy
- `docs/frontend/guides/hooks.md`
  - hook taxonomy, hook organization, and React behavior ownership
- `docs/frontend/guides/state.md`
  - Zustand, React Query, providers, local state, and derived state
- `docs/frontend/guides/lib.md`
  - domain logic, workflows, infra, config, copy, and presentation mappings
- `docs/frontend/guides/access.md`
  - cloud, AnyHarness, and Tauri access boundaries
- `docs/frontend/guides/styling.md`
  - styling, theme token, and UI primitive rules
- `docs/frontend/guides/telemetry.md`
  - analytics, Sentry, replay masking, and telemetry payload rules
- `docs/frontend/specs/chat-composer.md`
  - chat composer and composer-adjacent surfaces
- `docs/frontend/specs/chat-transcript.md`
  - transcript streaming, replay, row models, and long-history rendering
- `docs/frontend/specs/workspace-files.md`
  - workspace file browsing, file viewing, diff viewing, and Changes

## Authoritative server standards

- `docs/server/README.md`
  - start here for backend control-plane structure, hard rules, ownership, and folder rules

## Authoritative SDK standards

- `docs/sdk/README.md`
  - start here for `@anyharness/sdk` and `@anyharness/sdk-react` structure, boundaries, and ownership

## Authoritative AnyHarness standards

- `docs/anyharness/README.md`
  - start here for runtime crate boundaries, runtime structure, ownership, and read order
- `docs/anyharness/binary.md`
  - `anyharness` binary crate rules
- `docs/anyharness/contract.md`
  - `anyharness-contract` transport schema rules
- `docs/anyharness/src/*.md`
  - subsystem logic docs for ACP, agents, sessions, workspaces, git, files,
    and persistence

## Authoritative CI/CD standards

- `docs/ci-cd/README.md`
  - start here for release workflows, deployment infra, updater publishing, and
    the desktop in-app update flow

## Analytics and lifecycle reference

- `docs/analytics/anonymous-telemetry.md`
  - first-party install-level analytics records, routing, and storage
- `docs/analytics/posthog.md`
  - hosted-product desktop vendor analytics and replay
- `docs/analytics/customerio.md`
  - Customer.io lifecycle messaging integration

## Deployment and environment reference

- `docs/reference/dev-profiles.md`
  - local multi-worktree `make dev PROFILE=<name>` workflow, profile state,
    port allocation, and generated Tauri runner behavior
- `docs/reference/deployment-self-hosting.md`
  - complete setup runbook for every deployment mode (local dev, self-hosted,
    AWS CloudFormation, production)
- `docs/reference/env-vars.yaml`
  - canonical list of every env var across the stack, tagged by deployment mode
- `docs/reference/env-secrets-matrix.md`
  - operator-facing server env var surface
- `docs/reference/workspace-command-environment.md`
  - environment variables available to workspace run commands
- `docs/reference/self-hosted-deploy.md`
  - canonical Docker Compose self-hosted deployment
- `docs/reference/self-hosted-aws.md`
  - AWS CloudFormation one-click stack
