# Self-Hosted AWS Stack

This folder contains the CloudFormation template for the one-click AWS wrapper
around the canonical self-hosted deployment in `server/deploy/**`.

Template:

- [template.yaml](template.yaml)

Launch action:

- [launch-stack.sh](launch-stack.sh)

The template does not embed copies of the deploy scripts. On boot (and on every
`cfn-hup` update) it downloads the published `proliferate-deploy.tar.gz` bundle
for `server-v<ReleaseVersion>`, verifies it against
`self-hosted-assets.SHA256SUMS`, and extracts it into
`/opt/proliferate/server/deploy`, then writes `.env.static` and runs
`bootstrap.sh`. The host therefore runs the exact same `server/deploy/**`
scripts (installer, preflight, doctor, profile-aware bootstrap/update) as a
manual install — there is one deployment layer, not a drifting embedded copy.

## Launch

One real launch command, no repo clone. `launch-stack.sh` resolves a
`server-v*` release, downloads and checksum-verifies the published template,
validates it, and runs `aws cloudformation deploy`:

```bash
# Inspect first, then launch an evaluation stack (sslip.io host, real TLS):
curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/infra/self-hosted-aws/launch-stack.sh
less launch-stack.sh
bash launch-stack.sh --eval

# Real domain:
bash launch-stack.sh --site-address api.company.com \
  --github-oauth-client-id '<id>' --github-oauth-client-secret '<secret>'
```

It prints the stack outputs (`BaseUrl`, `SetupClaimUrl`, `ReadSetupTokenCommand`)
on success. Run `bash launch-stack.sh --help` for all options, or `--dry-run` to
resolve and validate the template without creating resources.

## Validate

```bash
aws cloudformation validate-template \
  --template-body file://server/infra/self-hosted-aws/template.yaml
```

## Example Deploy

```bash
aws cloudformation deploy \
  --stack-name proliferate-self-hosted-test \
  --template-file server/infra/self-hosted-aws/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    ReleaseVersion=0.1.0 \
    UseSslipFallback=true \
    GitHubOAuthClientId='<github-client-id>' \
    GitHubOAuthClientSecret='<github-client-secret>' \
    E2BApiKey='<e2b-api-key>' \
    E2BTemplateName='<e2b-template-name>'
```

`ReleaseVersion` is the unprefixed image tag, not the GitHub release tag. For a
GitHub release named `server-v0.1.0`, set `ReleaseVersion=0.1.0`.

This stack intentionally exposes only a common operator-facing subset of the
supported control-plane settings. Advanced auth-flow and sandbox-template
overrides remain in the server config layer; customize
[template.yaml](template.yaml)
if you need to promote more of them into CloudFormation parameters. The
curated supported application/runtime input catalog is
[specs/developing/reference/env-vars.yaml](../../../specs/developing/reference/env-vars.yaml).

## Versioned Release Assets

Each `server-v*` release should publish:

- `ghcr.io/proliferate-ai/proliferate-server:<version>`
- `anyharness-x86_64-unknown-linux-musl.tar.gz`
- `anyharness-aarch64-unknown-linux-musl.tar.gz`
- `proliferate-self-hosted-aws-template.yaml`
- `proliferate-deploy.tar.gz` (the deploy bundle the stack fetches and verifies)
- `proliferate-selfhost-aws-launch.sh` (the launch action above)
- `proliferate-selfhost-install.sh` (the non-AWS guided installer)
- `self-hosted-assets.SHA256SUMS`

The stack defaults to those release assets. For unreleased branch testing, use:

- `ServerImageRepository`
- `RuntimeBinaryUrl`
- `RuntimeBinaryChecksumUrl`
- `DeployBundleUrl` (point the stack at a deploy bundle from an unreleased build)
- `DeployBundleChecksumUrl` (matching `SHA256SUMS` for that bundle)
