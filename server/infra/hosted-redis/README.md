# Hosted server Redis ownership

This isolated Terraform root is the durable owner of one exact Redis
secret-read child policy on each hosted deploy role and ECS execution role. It
does not own the roles, secrets, secret values, task definitions, or services.

`server/deploy/hosted-redis-contract.json` is the single account-, region-, and
environment-bound contract consumed by this root and the server deploy
workflow. Each managed policy contains one `Allow`, one
`secretsmanager:GetSecretValue` action, and one exact resolved `server-app`
secret ARN.

The contract also names the allowed direct Redis secret or Parameter Store
reference for the optional worker/Beat re-image check. That background source
and its grants are not read or managed by this isolated root. The gated
definitions in `server/infra/background.tf` describe a future background
deployment surface; this contract does not assert ownership of the current
live background source or grants.

The roles also carry pre-existing policies for other task-start secrets. Some
bundle the Redis record with other exact or name-scoped resources and are not
owned here. Adoption adds a dedicated exact policy but does not make the
role's total effective permissions least-privilege; narrowing those shared
legacy policies requires their independently identified owner and is outside
this root.

## One-time non-destructive adoption

The two deploy-role policies predated this root. `imports.tf` made their
adoption explicit. The two dedicated execution-role policies were created by
the initial adoption. Never rebuild this state with an unsaved or unverified
first plan.

The first saved plan is acceptable only when the sanitizer reports exactly two
imports, two creates, zero updates, and zero deletes:

```bash
(
  set -euo pipefail
  terraform -chdir=server/infra/hosted-redis init
  terraform -chdir=server/infra/hosted-redis plan \
    -out=hosted-redis.tfplan >/dev/null 2>/dev/null
  terraform -chdir=server/infra/hosted-redis show \
    -json hosted-redis.tfplan 2>/dev/null \
    | python3 server/infra/hosted-redis/check_adoption_plan.py adoption
  terraform -chdir=server/infra/hosted-redis apply \
    hosted-redis.tfplan >/dev/null 2>/dev/null
)
```

The subshell's fail-fast and pipeline settings make apply conditional on both
`terraform show` and the sanitizer succeeding. Do not print, commit, or retain
a binary/JSON plan as a receipt; plan data contains infrastructure identifiers.
Record only the sanitizer's counts.

Normal operation and every post-apply check use a saved plan plus the
steady-state sanitizer:

```bash
(
  set -euo pipefail
  terraform -chdir=server/infra/hosted-redis plan \
    -out=hosted-redis-steady.tfplan >/dev/null 2>/dev/null
  terraform -chdir=server/infra/hosted-redis show \
    -json hosted-redis-steady.tfplan 2>/dev/null \
    | python3 server/infra/hosted-redis/check_adoption_plan.py steady-state
)
```

The steady-state result must be zero changes and zero drift. Remove both local
plan files after the review.

## Ownership transfer

Both resource types use `prevent_destroy`; there is intentionally no
`terraform destroy` rollback. A future de-adoption is an ownership transfer:
first land and prove an equivalent owner, then use a separately reviewed
state-only removal for the imported policies. Never delete a pre-existing
deploy policy or a production dependency as a shortcut for reverting state.
