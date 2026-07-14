# Self-Hosted AWS Launch Stack

This is the one-click AWS wrapper around the canonical self-hosted deployment in
[self-hosted-deploy.md](self-hosted-deploy.md).

The stack provisions:

- one public EC2 instance
- one Elastic IP
- one VPC with one public subnet
- one security group for ports `80` and `443`
- one SSM-enabled IAM role and instance profile
- optional Route53 A record

The host then runs the same production deployment from `server/deploy/**`:

- `caddy`
- `db`
- `migrate`
- `api`

The default stack uses Amazon Linux 2023 on Graviton (`arm64`) and currently
downloads the `aarch64` runtime archive. Cloud runtime-bundle discovery,
however, currently expects x86 Linux binaries for provider sandboxes. This is
an unresolved architecture contradiction: the default AWS cloud-workspace path
is not proven. Do not switch archive architectures without resolving and
testing that product boundary.

## What The Stack Does

On boot, and on every `cfn-hup` update, the stack downloads the published
`proliferate-deploy.tar.gz` bundle for `server-v<ReleaseVersion>`, verifies it
against `self-hosted-assets.SHA256SUMS`, and extracts it into
`/opt/proliferate/server/deploy`. The host therefore runs the exact same
`server/deploy/**` scripts (installer, `preflight.sh`, `doctor.sh`,
profile-aware `bootstrap.sh`/`update.sh`) as a manual install — one deployment
layer, not an embedded copy that can drift.

The CloudFormation template, launch script, deploy bundle, checksums, and both
runtime archives are assets of that same `server-v*` release. See
[Releases](releases.md) for the exact seven-file inventory.

CloudFormation itself only writes host-specific config:

- `/opt/proliferate/server/deploy/.env.static` (from the stack parameters)
- `cfn-hup` configuration so stack updates rerun the deploy flow in place

Operator overrides go in `/opt/proliferate/server/deploy/.env.local`, which
`ensure-secrets.sh` merges into `.env.runtime` and which survives the
CloudFormation `.env.static` rewrite on updates.
CloudFormation leaves `PROLIFERATE_PUBLIC_HEALTHCHECK_URL` blank in
`.env.static`. `ensure-secrets.sh` resolves the site address, derives the
public `/health` URL, and writes it to `.env.runtime`; the stack reports
success only after both the local API and that advertised public HTTPS endpoint
respond.

## Required Inputs

The base stack needs:

- an unprefixed release version like `0.1.0`
- a real `SiteAddress`, or `UseSslipFallback=true` for an evaluation stack

GitHub OAuth is optional and enables GitHub-based sign-in in Proliferate
Desktop; email/password can be used without it. E2B credentials are optional
and enable managed cloud sandboxes when `E2BApiKey` and `E2BTemplateName` are
both set. Cloud repository
access additionally requires a GitHub App configured through host-local
overrides. The LiteLLM gateway, SSO, and invitation email are also independent
optional capabilities rather than base-stack requirements.

The GitHub release tag still uses the `server-v*` line, but `ReleaseVersion`
should be the matching unprefixed image tag. Example:

- GitHub release tag: `server-v0.1.0`
- CloudFormation `ReleaseVersion`: `0.1.0`

The stack can auto-generate and persist these internal secrets on first
bootstrap if you leave them blank:

- `JWT_SECRET`
- `CLOUD_SECRET_KEY`
- `POSTGRES_PASSWORD`

For a real domain, set `SiteAddress` and optionally `HostedZoneId` when Route53
should create the DNS record.

Environment-boundary note:

- the stack only promotes the common self-hosted operator subset into
  CloudFormation parameters
- advanced auth-flow, agent-gateway, and sandbox-template overrides still exist in
  `server/proliferate/config.py`, but they intentionally stay on code defaults
  in the launch-stack flow unless you customize
  [template.yaml](../../../server/infra/self-hosted-aws/template.yaml)
  or add host-local overrides in `/opt/proliferate/server/deploy/.env.local`
- the curated supported application/runtime input catalog is
  [env-vars.yaml](../reference/env-vars.yaml)

## Desktop Configuration

Point the official desktop app at the stack output URL with:

```json
{
  "apiBaseUrl": "https://your-control-plane.example.com"
}
```

Write that to:

```text
~/.proliferate/config.json
```

## GitHub OAuth App

The GitHub OAuth app must use the stack hostname:

- Homepage URL: `https://<site-address>`
- Authorization callback URL: `https://<site-address>/auth/desktop/github/callback`

## Install Flow

The fastest path is the launch action, which resolves a `server-v*` release,
downloads and checksum-verifies the published template, validates it, and runs
`aws cloudformation deploy`:

```bash
curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/infra/self-hosted-aws/launch-stack.sh
bash launch-stack.sh --eval                 # evaluation, sslip.io host
bash launch-stack.sh --site-address api.company.com
```

It prints the `BaseUrl`, `SetupClaimUrl`, and `ReadSetupTokenCommand` outputs on
success. Claim the instance before ordinary Desktop sign-in or use: open
`SetupClaimUrl`, run `ReadSetupTokenCommand`, and enter that one-time token to
create the first admin. Later registration follows the configured sign-in and
invitation paths.

Or launch the CloudFormation stack manually:

1. Launch the CloudFormation stack with the template from
   [template.yaml](../../../server/infra/self-hosted-aws/template.yaml).
2. Wait for the stack to complete.
3. Read the `SetupClaimUrl` and `ReadSetupTokenCommand` outputs.
4. Open the claim URL, read the token through SSM, and create the first admin.
5. Read the `BaseUrl` output and set `~/.proliferate/config.json` to it.
6. Open Desktop and sign in through an enabled auth method.
7. Sync agent credentials.
8. If the E2B/runtime and repository-access capabilities are configured, create
   a cloud workspace. The default Graviton runtime-archive contradiction above
   means that path is not currently proven by this procedure.

The server's default leaves the agent gateway disabled; CloudFormation does
not write gateway settings into `.env.static`. Host-specific gateway settings
belong in `/opt/proliferate/server/deploy/.env.local`, which survives the
CloudFormation `.env.static` rewrite on release updates:

```text
AGENT_GATEWAY_ENABLED=true
AGENT_GATEWAY_LITELLM_BASE_URL=http://litellm:4000
AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=https://<site-address>/llm
AGENT_GATEWAY_LITELLM_MASTER_KEY=<same value as LITELLM_MASTER_KEY>
LITELLM_MASTER_KEY=<openssl rand -hex 32>
LITELLM_POSTGRES_PASSWORD=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<provider-key>
```

Then run `/opt/proliferate/server/deploy/update.sh`. Because
`AGENT_GATEWAY_ENABLED=true` is now in `.env.local`, `update.sh` automatically
pulls, starts, and updates the profiled `litellm`/`litellm-db` services (compose
profile `agent-gateway`) — no separate `--profile` command is needed. The
update script merges `.env.static` with `.env.local` and preserves the override
across later stack updates. The gateway is the bundled LiteLLM service, served
publicly under `/llm`, and it requires at least one provider credential.

## Update Flow

The normal update path is:

1. publish or choose a new `server-v*` release
2. update the stack `ReleaseVersion` to the matching unprefixed version
3. let `cfn-hup` rerun the in-place update

The update config set first downloads, verifies, and extracts the deploy bundle
for the selected `ReleaseVersion`, rewrites stack-owned `.env.static`, and then
invokes the canonical `./update.sh`. That script resolves config and generated
secrets, runs preflight and registry login, refreshes the selected runtime
archive, pulls enabled images, migrates, reconciles base and optional-profile
services, and waits for health. Bare Compose commands are not an equivalent
update path.

## Advanced Overrides

The stack also supports advanced override parameters:

- `ServerImageRepository`
  - use this when you need the host to pull from a private ECR repo instead of GHCR
- `RuntimeBinaryUrl`
  - use this when testing an unreleased runtime tarball before a `server-v*` release exists
- `RuntimeBinaryChecksumUrl`
  - use this with `RuntimeBinaryUrl` when you also have a matching `SHA256SUMS` file for the unreleased tarball

Those overrides exist so the stack can be validated before the first tagged
self-hosted release is cut. The normal release path should leave both at their
defaults.
