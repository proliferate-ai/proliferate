# Self-Hosted AWS Stack

This folder contains the CloudFormation template for the one-click AWS wrapper
around the canonical self-hosted deployment in `server/deploy/**`.

Template:

- [template.yaml](/Users/pablo/proliferate-local-desktop/server/infra/self-hosted-aws/template.yaml)

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
    SandboxProvider=e2b \
    E2BApiKey='<e2b-api-key>'
```

`ReleaseVersion` is the unprefixed image tag, not the GitHub release tag. For a
GitHub release named `server-v0.1.0`, set `ReleaseVersion=0.1.0`.

This stack intentionally exposes only the common operator-facing subset of the
full control-plane env surface. Advanced auth-flow and sandbox-template
overrides remain in the server config layer; customize
[template.yaml](/Users/pablo/proliferate-local-desktop/server/infra/self-hosted-aws/template.yaml)
if you need to promote more of them into CloudFormation parameters. The full
env surface is documented in
[docs/reference/env-secrets-matrix.md](/Users/pablo/proliferate-local-desktop/docs/reference/env-secrets-matrix.md).

## Versioned Release Assets

Each `server-v*` release should publish:

- `ghcr.io/proliferate-ai/proliferate-server:<version>`
- `anyharness-x86_64-unknown-linux-musl.tar.gz`
- `anyharness-aarch64-unknown-linux-musl.tar.gz`
- `proliferate-self-hosted-aws-template.yaml`

The stack defaults to those release assets. For unreleased branch testing, use:

- `ServerImageRepository`
- `RuntimeBinaryUrl`
- `RuntimeBinaryChecksumUrl`
