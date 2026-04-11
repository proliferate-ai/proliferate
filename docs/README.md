# Proliferate Docs

This repo includes both:

- implementation docs for Proliferate itself
- implementation docs for AnyHarness itself
- design/reference research snapshots

Read the relevant area doc before touching code in that area. Do that at the
start of the task, not after implementation has already started.

## Authoritative frontend standards

- `docs/frontend/README.md`
  - start here for frontend structure, ownership, data flow, and folder rules
- `docs/frontend/styling.md`
  - styling, theme token, and UI primitive rules

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

- `docs/reference/deployment-self-hosting.md`
  - complete setup runbook for every deployment mode (local dev, self-hosted,
    AWS CloudFormation, production)
- `docs/reference/env-vars.yaml`
  - canonical list of every env var across the stack, tagged by deployment mode
- `docs/reference/env-secrets-matrix.md`
  - operator-facing server env var surface
- `docs/reference/self-hosted-deploy.md`
  - canonical Docker Compose self-hosted deployment
- `docs/reference/self-hosted-aws.md`
  - AWS CloudFormation one-click stack
