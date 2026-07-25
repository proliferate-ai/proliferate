# Catalog Probe Operations

Status: current procedure

Use this runbook to provision, rotate, revoke, audit, or manually verify the
daily `Catalog Probe` workflow. The durable catalog producer contract lives in
[Agent Distribution](../../codebase/platforms/product/agent-distribution.md),
and the workflow's delivery role lives in the
[Delivery system](../../codebase/systems/engineering/delivery/README.md).

## Ownership And Boundaries

- `.github/workflows/catalog-probe.yml` is owned by the workflow CODEOWNER,
  `@pablonyx`. The `Catalog Probe` environment variable
  `CATALOG_PROBE_CREDENTIAL_OWNER` names the current lifecycle owner.
- Provider credentials belong only to the protected `Catalog Probe` GitHub
  Environment. Its deployment branch policy permits `main` only. Do not put
  these values at repository scope or in `Production`, `staging`,
  `Qualification`, a developer profile, or a personal workstation export.
- The environment must contain dedicated organization-owned automation
  credentials. Production application credentials, release-qualification
  credentials, and personal OAuth sessions are not substitutes.
- The probe job has read-only repository permission. Secret references exist
  only on the two first-party steps that materialize OAuth input and run the
  probe. A separate job without provider credentials owns branch pushes and PR
  creation.
- Cursor stays excluded because its supported authentication is an interactive
  machine-local login. The scheduled environment must not contain copied
  Cursor session material.

## Required Credential Inventory

The lifecycle owner must prove every row before setting
`CATALOG_PROBE_CREDENTIALS_APPROVED=true`. Record the provider account or
workspace, credential owner, creation date, last rotation, next rotation,
billing/quota cap, and revocation location in the organization credential
manager. Those records may contain provider identifiers, so they do not belong
in GitHub issues, PRs, workflow logs, or this repository.

| Environment secret | Injected probe variable | Required probe contexts | Least-privilege and billing guardrail | Rotation and revocation |
| --- | --- | --- | --- | --- |
| `CATALOG_PROBE_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | `claude.anthropic-api`, `opencode.anthropic-api` | Dedicated probe project/workspace; inference only; provider-native monthly spend cap or automatic quota stop sized for one daily probe. | Rotate at most every 90 days. Revoke in the dedicated provider project, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_CLAUDE_CODE_OAUTH_TOKEN` | `CLAUDE_CODE_OAUTH_TOKEN` | `claude.anthropic-oauth` | Dedicated organization automation identity; no personal subscription or workstation dependency; no administrative scope; bounded organization usage. | Prove non-interactive refresh at least every 30 days. On expiry or compromise, revoke the identity/session, delete the secret, and set approval false. |
| `CATALOG_PROBE_OPENAI_API_KEY` | `OPENAI_API_KEY` | `codex.openai-api`, `opencode.openai-api` | Dedicated probe project; model/inference access only; provider-native project budget cap or automatic quota stop. | Rotate at most every 90 days. Revoke in the probe project, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_CODEX_AUTH_JSON_B64` | `CODEX_AUTH_JSON_B64` | `codex.openai-oauth` | Base64 of the complete auth document for a dedicated organization automation identity; must refresh without a personal workstation. The workflow decodes it only into a mode-`0600` runner-temporary file and deletes that file after probing. | Prove refresh at least every 30 days. Revoke the automation session, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_AWS_BEARER_TOKEN_BEDROCK` | `AWS_BEARER_TOKEN_BEDROCK` | `claude.bedrock`, `codex.bedrock` | Dedicated Bedrock automation principal/token; model invocation only for the probed models and region; no general AWS control-plane permission; automatic budget/quota enforcement. | Rotate at most every 90 days or the provider maximum, whichever is shorter. Revoke the token/principal, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_GEMINI_API_KEY` | `GEMINI_API_KEY` | `opencode.gemini-api` | Dedicated probe project; Generative Language/model invocation only; API and project restrictions plus an automatic quota stop. | Rotate at most every 90 days. Revoke in the dedicated project, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_OPENCODE_API_KEY` | `OPENCODE_API_KEY` | `opencode.opencode-zen` | Dedicated probe account/project; inference only; provider-native spend cap or automatic quota stop. | Rotate at most every 90 days. Revoke in the dedicated provider account, delete the environment secret, and set approval false. |
| `CATALOG_PROBE_XAI_API_KEY` | `XAI_API_KEY` | `grok.xai-api` | Dedicated probe team/project; inference only; provider-native spend cap or automatic quota stop. | Rotate at most every 90 days. Revoke in the dedicated project, delete the environment secret, and set approval false. |

A provider budget alert without automatic enforcement is evidence, not a cap.
If a provider cannot enforce a cap or quota stop, keep approval false until the
lifecycle owner records an explicitly authorized bounded-spend alternative.

## Environment Guard

Configure these non-secret variables on the `Catalog Probe` environment:

| Variable | Value |
| --- | --- |
| `CATALOG_PROBE_CREDENTIAL_OWNER` | GitHub login or team that owns rotation, billing, failure triage, and revocation. |
| `CATALOG_PROBE_CREDENTIALS_APPROVED` | `true` only after all eight dedicated rows are present and the inventory above is proven; otherwise `false`. |
| `CATALOG_PROBE_ROTATION_DUE` | Earliest next rotation date across the eight credentials, in `YYYY-MM-DD` UTC form. |

The workflow validates these variables before referencing any provider secret.
An absent approval, owner, invalid date, or passed rotation date fails closed.
When any credential is rotated, revoked, expired, over budget, or of uncertain
ownership, first set approval to `false`; restore `true` only after every row is
healthy and update the earliest due date.

## Provision Or Rotate

Required access: repository environment administration plus provider access
for the dedicated automation project/account. Never put a value in a CLI
argument. Use the GitHub UI or a secret-store-backed authenticated tool that
accepts the value through protected standard input.

1. Set `CATALOG_PROBE_CREDENTIALS_APPROVED=false`.
2. Confirm the environment allows only `main` and has no inherited repository,
   staging, Qualification, or Production provider credentials.
3. In each provider's organization console, confirm the owner, dedicated
   project/account, exact scope, billing/quota enforcement, and revocation
   control. Create or rotate only credentials already authorized by the
   organization; this procedure does not authorize a new billable account.
4. Store each value under the exact `CATALOG_PROBE_*` environment secret name
   in the table. The unique prefix prevents GitHub from silently satisfying a
   missing environment value from a generic repository or organization secret.
   For `CATALOG_PROBE_CODEX_AUTH_JSON_B64`, encode the whole dedicated auth
   document without printing it and send the encoded bytes directly to the
   environment secret.
5. Prove both OAuth credentials can refresh without a personal workstation.
6. Update the owner and earliest rotation date, then set approval to `true`.
7. Manually dispatch `Catalog Probe` from `main`. Do not use a PR branch.

## Verify A Manual Probe

The run is complete only when:

1. `Verify credential lifecycle approval` passes.
2. `Resolve, install, probe, and finalize catalog` records `complete=true` and
   every required non-Cursor context as `passed=` in the sanitized step
   summary.
3. The viewer and sanitized catalog-output artifacts upload successfully.
4. The separate publish job reaches `Open catalog PR when the draft changed`;
   either it reports no diff or opens the expected catalog PR.
5. No raw credential, auth document, provider identifier, prompt, response, or
   probe log appears in the summary, artifacts, issue alert, or PR.

Inspect only the step names, conclusions, sanitized `run.state`, and generated
catalog outputs. Do not paste raw logs into an issue. A failed scheduled run
creates or updates the deduplicated
`ops(agent-catalog): Catalog Probe scheduled failure` issue and assigns the
workflow owner when that account remains assignable. The alert issue is created
before assignment is attempted, so assignment drift cannot suppress the alert;
route an unassigned alert through the workflow CODEOWNER.

## Revoke Or Respond To Failure

1. Set `CATALOG_PROBE_CREDENTIALS_APPROVED=false` before investigating a
   suspected compromise, ownership ambiguity, expired refresh path, passed
   rotation date, or billing breach.
2. Revoke the affected credential at its dedicated provider project/account,
   then delete the corresponding GitHub environment secret. Do not begin by
   deleting the secret if that would leave a still-valid provider credential.
3. Inspect the failing workflow's sanitized state to identify the affected
   context. Confirm provider status, quota, and refresh health in the owning
   console without copying values or raw responses.
4. Rotate or repair only with the authority described above. Re-run the full
   non-Cursor matrix; a focused or partial diagnostic is not promotion proof.
5. Close the operational alert only after the full manual verification passes
   and the next scheduled run has an owned response path.

If any credential owner, scope, cap, refresh path, or revocation control cannot
be proven, leave the workflow blocked and hand the exact missing secret names
and metadata fields to the lifecycle owner. Never fall back to Production,
Qualification, staging, or personal credentials.
