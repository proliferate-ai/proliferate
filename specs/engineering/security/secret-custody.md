# Secret custody

Status: current (grade C, capability page). Answers "who holds which secret, encrypted how, and who may read it" across the control plane after the 2026-08 cull. There is no `secrets` *system*: custody is a law each owning system obeys, backed by one crypto capability.

## The capability

[`server/proliferate/lib/infra/encryption`](../../../server/proliferate/lib/infra/encryption) is the only place ciphertext is produced or opened. Systems store ciphertext columns; they never roll their own crypto and never log plaintext.

## Custody map (one owner per secret class)

| Secret class | Owner | Storage | Readers |
| --- | --- | --- | --- |
| Sign-in provider tokens (GitHub/Google/Apple grants) | `accounts` | `provider_grant.access_token_ciphertext` / `refresh_token_ciphertext` | accounts only (readiness, profile sync) |
| Agent/LLM credentials (typed key vault) | `agent_auth` | `agent_gateway` vault rows (`kind` vocabulary from the harness registry) | agent_auth; materialized into a runtime's `state.json` at launch |
| Gateway virtual keys | `model_gateway` (agent_auth today) | LiteLLM-issued, per subject/run | model gateway proxy |
| Third-party integration connection tokens | `integration_gateway` | `integration_authorization` ciphertext; revocation jobs | the gateway, per tool call — never the sandbox |
| GitHub App installation/user tokens | `github` | `github_app` models | github system; bot vs as-user identity |
| Worker bearer tokens | `seam/workers` | hashed, never stored plain | worker auth dependency |
| Stripe keys, JWT secret, OAuth client secrets | deployment config | env / secret manager (`specs/areas/env-vars.yaml`, `secret: true`) | process only |
| Support diagnostics scrub | `support` | not stored — scrubbed before staging | — |
| **User/org/workspace secret sets** (env vars + files for sandboxes) | **none — deleted** | `cloud_secret_*` tables and `server/cloud/secrets/**` are removed by cull PR-Ab | — |

## Laws

1. One secret class, one owner; the owner's spec names the column and the
   reader set. A second system needing the value consumes a *capability* of
   the owner (resolve-per-call), never the row.
2. Ciphertext at rest, plaintext only in process memory on the read path;
   `check_agent_auth_secret_logs.py` is the log-redaction proof for the vault
   and every new class must add its own canary.
3. Headless runs never hold human credentials (Core Architecture law 7): what
   reaches a task environment is a per-run, attenuated credential minted by
   the owner (virtual key, scoped grant), never the stored secret.
4. Revocation is a row update effective on the next call — no
   re-materialization.

## Decision

> [!decision] PABLO DECIDES: do org-level secret sets come back for task
> environments? The deleted `cloud/secrets` surface let a user/org/workspace
> declare env vars and files that materialization injected into the sandbox.
> The environments rebuild will need *some* way to give a task environment
> repo-specific credentials (e.g. a `DATABASE_URL` for tests). Options:
> (a) rebuild as a section of `environments` ("environment secret set", org
> scoped, versioned, injected at provision) — recommended, it is provisioning
> data; (b) route everything through `integration_gateway` grants (pure
> capability-per-call; no arbitrary env vars); (c) leave to the harness's own
> config. Recommendation: (a) with the injection point owned by provisioning
> and the ciphertext column obeying this page.
