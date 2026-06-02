# Reference

Status: authoritative index for canonical reference material.

Reference docs are looked up, not read end-to-end. They provide the
single source of truth for environment variables, secrets, and runtime
environment shapes so that deploying, local, and runbook docs can link
here rather than duplicate values.

## Reference Map

| Reference | Owns |
| --- | --- |
| [env-vars.yaml](env-vars.yaml) | Canonical inventory of every deploy-time environment variable: name, owner, surfaces it appears in, required/optional, and secret classification. |
| [env-secrets-matrix.md](env-secrets-matrix.md) | Matrix of which secrets are required per deploy surface (hosted, self-hosted, local, CI) and where each value lives (GitHub environment, AWS SSM, local .env). |
| [workspace-command-environment.md](workspace-command-environment.md) | Variables injected into each cloud workspace command environment: what is set, where it comes from, and which values are safe to read from agent context. |

## Usage

- When adding or renaming an environment variable, update `env-vars.yaml`
  first, then update `env-secrets-matrix.md` if the secret classification
  or surface coverage changes.
- When changing what is injected into command environments, update
  `workspace-command-environment.md` in the same PR.
- Deploying and local-dev docs link to these files rather than duplicating
  variable names or values.
