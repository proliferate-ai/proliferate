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
- [web-desktop-unification-rollout.md](web-desktop-unification-rollout.md):
  binding execution and freeze ledger for the Web/Desktop client unification
  chain — chain state, PR-1 intake snapshots, the PR-2 freeze ledger, and the
  deployment-selection/external-configuration item schema. The contract itself
  is canonical at
  [`../../codebase/features/web-desktop-client-unification.md`](../../codebase/features/web-desktop-client-unification.md).

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
   - nightly trains and production hotfixes are coordinated by the release
     train workflows in [ci-cd.md](ci-cd.md)
   - user-facing releases must also update the landing page, public docs,
     changelog/release notes, or in-app copy when the shipped behavior changes
     those surfaces

## Tools And Permissions

The lane-specific source of truth is [ci-cd.md](ci-cd.md). This entrypoint
names the minimum operator surface before choosing a lane.

Required tools and surfaces:

- GitHub MCP, `gh`, or GitHub web access for Actions runs, environment
  approvals, PR labels, release notes, release artifacts, and deploy logs.
- Local shell access for helper scripts, release dry runs, SDK/runtime builds,
  Docker checks, and deployment verification commands.
- Browser or Chrome access with the right logged-in profile for GitHub, AWS,
  Vercel, E2B, Stripe, Cloudflare, Expo, Apple, and public docs or landing-page
  verification.
- AWS CLI or console access for ECS, ECR, RDS, S3, CloudFront, IAM, SSM, and
  updater or self-hosted release infrastructure when those lanes are in scope.
- Vercel, E2B, Expo/EAS, App Store Connect, Stripe, and Cloudflare access only
  for release lanes that touch those providers.

Required permissions by lane:

| Lane | Permissions |
| --- | --- |
| Hosted staging / production | GitHub Actions access, required GitHub environment approval rights, and AWS/Vercel/E2B access for the selected surfaces |
| Desktop updater | repo write access, release-artifact access, desktop signing/updater infra access, and permission to verify updater manifests |
| Runtime / SDK / server image | repo write access, GitHub release/workflow access, registry access for the published artifact, and permission to run the owning build workflow |
| Mobile / TestFlight | Expo/EAS access and App Store Connect access for build submission, review metadata, or TestFlight verification |
| Environment variables | GitHub environment admin or maintainer access, plus AWS SSM access when ECS runtime secrets must be inspected or repaired |
| Landing page / public docs | repo or hosted CMS access for the public surface, plus release-note ownership for user-visible changes |

Do not paste secret values, deploy tokens, signing credentials, webhook
secrets, private keys, AWS credentials, or provider refresh tokens into chat,
docs, PRs, issues, or logs. Use
[`../reference/env-vars.yaml`](../reference/env-vars.yaml) for canonical
deployment variable ownership.

## Operator Rules

- For hosted staging or production, start with the agent deployment runbook in
  [ci-cd.md](ci-cd.md).
- Deploy hosted production only from an exact SHA on `main` after verifying the
  staging deploy requirement or explicitly documenting an approved bypass.
- Do not call a deploy complete until every selected lane has finished and the
  relevant URLs, updater manifests, release artifacts, or app-store surfaces
  have been verified.
- For launch posts, changelog entries, support notes, and customer-facing
  version references, cite the public `Proliferate vX.Y.Z` version from
  `VERSION` / `proliferate-v*` first. Artifact tags such as `desktop-v*`,
  `runtime-v*`, and `server-v*` are technical release coordinates.
- For raw technical release notes, link the GitHub Release at
  `proliferate-v*`; no-version hotfixes use the `hotfix-*` GitHub Release.
  Handwritten changelog pages are separate polished product surfaces.
- Treat GitHub environments as the deploy-time source of truth for hosted
  variables and secrets. Treat AWS SSM as the ECS runtime destination for
  copied server secrets.
- For self-hosted releases, use versioned `server-v*` release artifacts and the
  `server/deploy/**` scripts. Do not create a second deployment path that can
  drift from the canonical Compose surface.
