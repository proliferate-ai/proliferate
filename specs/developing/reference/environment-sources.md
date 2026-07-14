# Environment Sources

Status: current configuration-source and precedence reference.

This document routes operators and developers to the files or systems that
supply environment configuration. It describes locations and precedence, not
secret values. The curated catalog of supported product inputs is
[`env-vars.yaml`](env-vars.yaml); deployment/bootstrap-only inputs and
workflow/release controls remain with their owning procedures.

## Direct Local Server

When the server runs directly from the `server/` directory, its settings load
optional files in this order:

1. `server/.env`
2. `server/.env.local`

The later local file overrides the earlier file. An explicit process
environment remains the runtime override accepted by the settings library.
There is no home-directory fallback for direct server settings.

## Profile-Based Local Development

The baseline environment-file composition used by `make run PROFILE=<name>` is,
from lower to higher precedence:

1. root `.env`
2. root `.env.local`
3. `server/.env`
4. `server/.env.local`
5. generated profile `launch.env` for profile-owned values

Profile state lives below
`~/.proliferate-local/dev/profiles/<name>/`. Within that directory,
`profile.env` persists profile allocation and input state used to generate
`launch.env`; the launcher does not source `profile.env` directly as the
process environment.

After composing the baseline files, the launcher:

1. loads the selected `.auth-env/.env.<auth-profile>` file, when an auth
   profile was selected;
2. adds conditional Stripe CLI and local Codex program values;
3. restores the incoming `DATABASE_URL` when one was supplied, or derives the
   selected profile's database URL; and
4. overwrites launcher-owned API, CORS, and Stripe callback URLs.

These launcher-owned values intentionally win over earlier files. See
[`../local/README.md`](../local/README.md) before creating or running a local
profile.

## Self-Hosted Deployment

The canonical self-hosted deployment composes:

1. `.env.static` for reviewed operator configuration;
2. `.env.local` for unmanaged host-local overrides; and
3. `.env.generated` for stable stack-managed secrets.

The deployment scripts produce `.env.runtime`, which is the environment file
passed to Docker Compose. Unmanaged `.env.local` entries override unmanaged
`.env.static` entries. The scripts write managed configuration and secrets
last, so those resolved values win in `.env.runtime`. Preserve
`.env.generated`, and do not edit `.env.runtime` directly.

Use [`../deploying/self-hosted-deploy.md`](../deploying/self-hosted-deploy.md)
for the canonical Compose procedure and
[`../deploying/self-hosted-aws.md`](../deploying/self-hosted-aws.md) for the AWS
launch-stack wrapper.

## Hosted Server

Terraform provisions the baseline ECS task definition. The hosted deploy
workflow then reads the live service definition, renders the next revision's
runtime environment, and registers that revision. Most current sensitive
inputs are written as ordinary task-definition environment entries. Only
values explicitly configured in the ECS `secrets` collection are resolved from
SSM. Do not infer universal secret-manager storage from a variable's secret
classification.

Hosted workflow inputs and deployment procedures are owned by
[`../deploying/ci-cd.md`](../deploying/ci-cd.md).

## Frontend, Mobile, and Desktop Native Builds

Frontend, mobile, and desktop-native build inputs come from each surface's
owning build configuration and the environment supplied by its build provider
or CI job. Consult the owning surface and its release procedure before changing
an input; these build environments do not share one repository-wide precedence
chain.

## Workflow and Release Controls

Workflow-only, publishing, signing, upload, and release-promotion controls are
owned by the workflow that consumes them and by
[`../deploying/README.md`](../deploying/README.md). They are deliberately
outside the application/runtime input catalog.

## Workspace and Agent Commands

AnyHarness owns the environment assembled for workspace process runs,
terminals, setup commands, and live agent launches. Its file layers and
protected metadata are documented in
[`workspace-command-environment.md`](workspace-command-environment.md).
