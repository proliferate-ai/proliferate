# Tier C: Support / Security / Ops Runbooks

Status: planning target for operational follow-through.

## Starting Baseline

This track can run after PR 529 but is not blocked on it except where runbooks
describe managed target replacement or worker enrollment. Draft docs in
`specs/tbd/**` are not review law until promoted or clearly scoped.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/spec-catalog.md`
- `specs/tbd/security.md`
- `specs/tbd/support-debug-correlation.md`
- `specs/codebase/features/support-reporting.md`
- `specs/developing/deploying/ci-cd.md`
- Relevant cloud, billing, worker, and support specs for each runbook

## Intended End State

Operational gaps are closed with docs, diagnostics, and where needed code:

- runbooks exist for cloud provisioning failure, worker enrollment failure,
  Stripe webhook failure, managed target replacement, and E2B template rollback
- support/debug correlation surfaces give enough IDs and state to diagnose
  cloud/runtime/auth/billing issues
- sensitive fields are redacted in logs, support payloads, telemetry, and Sentry
- support reporting has clear ownership for public/private details
- deployment and rollback docs reflect the current managed cloud architecture

## Owned Files / Surfaces

- `specs/developing/**` runbooks or operational docs
- `specs/codebase/features/support-reporting.md` and support-related specs
- server support diagnostics/reporting code
- Sentry/logging redaction helpers
- support tracker integrations
- CI/CD docs if deployment or rollback flows change

## Out Of Scope

- Rewriting cloud provisioning, worker enrollment, or billing behavior unless a
  runbook gap exposes a concrete missing diagnostic or safe remediation hook.
- Broad security program work not tied to the merged specs.

## Migration Slices

1. **Gap inventory**
   - Convert catalog gaps into a concrete checklist.
   - Decide which gaps need docs only and which need code diagnostics.
2. **Runbook promotion**
   - Add runbooks under the correct `specs/developing/**` or codebase owner.
   - Link from relevant READMEs.
3. **Support/debug correlation**
   - Add missing IDs/state to support diagnostics and reports.
   - Ensure target/profile/sandbox/runtime identifiers are understandable after
     PR 529.
4. **Security/redaction pass**
   - Audit logs, Sentry tags, support payloads, and report attachments.
5. **Rollback/deploy docs**
   - Update E2B template rollback, managed target replacement, and deployment
     failure handling.
6. **Smoke and review**
   - Validate runbooks against current staging/dev commands where possible.

## Data / Contract Changes

Usually none. Possible additions:

- support diagnostics fields
- internal admin/support API fields
- redaction metadata

## Backward Compatibility And Deletion Plan

Docs can be added incrementally. For diagnostics, avoid removing fields support
already uses unless replacements are documented.

## Verification

- Server tests for diagnostics/redaction changes
- Support-reporting tests if payload shape changes
- Manual runbook dry run for each operational flow
- `git diff --check`

## Risks And Open Questions

- Runbooks can become stale quickly. Assign owners and link to source-of-truth
  commands.
- Diagnostics can leak secrets if redaction is not reviewed carefully.
- Some draft security/support docs may need promotion before code review relies
  on them.

## Critique Prompts

Plan critique:

```text
Review the support/security/ops plan. Are gaps grounded in merged docs or known
operational failures? Are docs and code changes separated? Are redaction and
ownership addressed? Return findings first.
```

Implementation critique:

```text
Review the support/security/ops diff. Look for stale runbook commands, missing
owners, secret leakage, unsupported diagnostics assumptions, and untested support
payload changes. Return findings first.
```
