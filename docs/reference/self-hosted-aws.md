# Self-Hosted AWS Launch Stack

This is the one-click AWS wrapper around the canonical self-hosted deployment in
[docs/reference/self-hosted-deploy.md](/Users/pablo/proliferate/docs/reference/self-hosted-deploy.md).

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

The default stack uses Amazon Linux 2023 on Graviton (`arm64`), but it still
downloads the `x86_64` Linux `anyharness` tarball because that binary is copied
into provider-hosted cloud sandboxes rather than executed on the EC2 host.

## What The Stack Does

CloudFormation writes these files onto the EC2 host:

- `/opt/proliferate/server/deploy/docker-compose.production.yml`
- `/opt/proliferate/server/deploy/Caddyfile`
- `/opt/proliferate/server/deploy/bootstrap.sh`
- `/opt/proliferate/server/deploy/ensure-secrets.sh`
- `/opt/proliferate/server/deploy/install-runtime.sh`
- `/opt/proliferate/server/deploy/registry-login.sh`
- `/opt/proliferate/server/deploy/update.sh`
- `/opt/proliferate/server/deploy/wait-for-health.sh`
- `/opt/proliferate/server/deploy/.env.static`

It also installs `cfn-hup` so stack updates rerun the deploy flow in place.
The generated `.env.static` sets
`PROLIFERATE_PUBLIC_HEALTHCHECK_URL=https://<site-address>/health` so the stack
only reports success after both the local API and the advertised public HTTPS
endpoint respond.

## Required Inputs

You need:

- an unprefixed release version like `0.1.0`
- GitHub OAuth credentials if you want desktop sign-in
- E2B or Daytona credentials if you want cloud workspaces

The GitHub release tag still uses the `server-v*` line, but `ReleaseVersion`
should be the matching unprefixed image tag. Example:

- GitHub release tag: `server-v0.1.0`
- CloudFormation `ReleaseVersion`: `0.1.0`

The stack can auto-generate and persist these internal secrets on first
bootstrap if you leave them blank:

- `JWT_SECRET`
- `CLOUD_SECRET_KEY`
- `POSTGRES_PASSWORD`

For a real domain:

- `SiteAddress`
- optionally `HostedZoneId` if Route53 should create the DNS record

For evaluation stacks:

- set `UseSslipFallback=true`

Environment-boundary note:

- the stack only promotes the common self-hosted operator subset into
  CloudFormation parameters
- advanced auth-flow and sandbox-template overrides still exist in
  `server/proliferate/config.py`, but they intentionally stay on code defaults
  in the launch-stack flow unless you customize
  [template.yaml](/Users/pablo/proliferate/server/infra/self-hosted-aws/template.yaml)
  or edit the generated `.env.static` on the host
- the full control-plane env surface is documented in
  [docs/reference/env-secrets-matrix.md](/Users/pablo/proliferate/docs/reference/env-secrets-matrix.md)

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

1. Launch the CloudFormation stack with the template from
   [template.yaml](/Users/pablo/proliferate/server/infra/self-hosted-aws/template.yaml).
2. Wait for the stack to complete.
3. Read the `BaseUrl` output.
4. Set `~/.proliferate/config.json` to that `BaseUrl`.
5. Open the desktop app and sign in with GitHub.
6. Sync Codex credentials.
7. Create a cloud workspace.

## Update Flow

The normal update path is:

1. publish or choose a new `server-v*` release
2. update the stack `ReleaseVersion` to the matching unprefixed version
3. let `cfn-hup` rerun the in-place update

That update runs the same canonical commands:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml run --rm migrate
docker compose -f docker-compose.production.yml up -d
```

## Advanced Overrides

The stack also supports two advanced override parameters:

- `ServerImageRepository`
  - use this when you need the host to pull from a private ECR repo instead of GHCR
- `RuntimeBinaryUrl`
  - use this when testing an unreleased runtime tarball before a `server-v*` release exists
- `RuntimeBinaryChecksumUrl`
  - use this with `RuntimeBinaryUrl` when you also have a matching `SHA256SUMS` file for the unreleased tarball

Those overrides exist so the stack can be validated before the first tagged
self-hosted release is cut. The normal release path should leave both at their
defaults.
