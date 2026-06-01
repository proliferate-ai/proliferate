# Deploying

Status: authoritative entry point for deployment and release operations.

Use this folder for hosted staging/production deploys, release workflows,
desktop updater publishing, runtime/template releases, deployment
configuration, and self-hosted deployment. Local development belongs under
[`../local/`](../local/), and incident investigation belongs under
[`../debugging/`](../debugging/).

## Read Order

- [ci-cd.md](ci-cd.md): hosted CI, PR metadata, staging deploys, production
  promotion, release lanes, desktop updater publishing, mobile/TestFlight,
  E2B template releases, environment variables, and production inventory.
- [self-hosted-deploy.md](self-hosted-deploy.md): canonical self-hosted Docker
  Compose deployment, desktop runtime override, first-time setup, updates, and
  image sources.
- [self-hosted-aws.md](self-hosted-aws.md): one-click AWS CloudFormation launch
  stack that bootstraps the canonical self-hosted deployment.

## Process Map

Use this folder to answer four deployment questions:

1. Full stack / infrastructure:
   - hosted API, web, desktop, mobile, E2B, workers, updater, S3, CloudFront,
     ECS, ECR, RDS, IAM, and Vercel ownership are covered in
     [ci-cd.md](ci-cd.md)
   - self-hosted Docker ownership is covered in
     [self-hosted-deploy.md](self-hosted-deploy.md)
   - self-hosted AWS launch-stack ownership is covered in
     [self-hosted-aws.md](self-hosted-aws.md)
2. Environment variables and where they live:
   - hosted deploy-time values live in GitHub environments
   - ECS runtime secrets may be copied to AWS SSM SecureString parameters
   - canonical variable inventory lives in
     [`../reference/env-vars.yaml`](../reference/env-vars.yaml)
   - operator-facing deploy/env guidance lives in [ci-cd.md](ci-cd.md)
3. Production / staging deployment process:
   - staging deploy, production promote, forced surfaces, dry runs, approval
     gates, and verification are covered in the agent deployment runbook at the
     top of [ci-cd.md](ci-cd.md)
4. New release process:
   - desktop, runtime/SDK, cloud template, server image, mobile/TestFlight, and
     hosted web/API release paths live in [ci-cd.md](ci-cd.md)
   - user-facing releases must also update the landing page, public docs,
     changelog/release notes, or in-app copy when the shipped behavior changes
     those surfaces

## Operator Rules

- For hosted staging or production, start with the agent deployment runbook in
  [ci-cd.md](ci-cd.md).
- Deploy hosted production only from an exact SHA on `main` after verifying the
  staging deploy requirement or explicitly documenting an approved bypass.
- Do not call a deploy complete until every selected lane has finished and the
  relevant URLs, updater manifests, release artifacts, or app-store surfaces
  have been verified.
- Treat GitHub environments as the deploy-time source of truth for hosted
  variables and secrets. Treat AWS SSM as the ECS runtime destination for
  copied server secrets.
- For self-hosted releases, use versioned `server-v*` release artifacts and the
  `server/deploy/**` scripts. Do not create a second deployment path that can
  drift from the canonical Compose surface.
