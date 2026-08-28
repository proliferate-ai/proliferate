# Deploying

Use this folder for current deployment and release procedures. The durable
workflow and artifact topology lives in the
[Delivery system](../../specs/engineering/ci-cd/release-delivery.md).

When this documentation and the checked-in automation disagree, verify the
workflow or source at the exact revision and correct the owning document in the
same change.

## Choose a Task

| Task | Procedure |
| --- | --- |
| Deploy to hosted staging or production, inspect a plan, verify a deploy, or recover a failed lane | [Hosted deployments](hosted.md) |
| Run or verify a nightly train, production hotfix, Desktop/Runtime/Server release, or E2B template promotion | [Releases](releases.md) |
| Install or update the canonical self-hosted Compose deployment | [Self-hosted deployment](self-hosted-deploy.md) |
| Launch or update self-hosting through AWS CloudFormation | [Self-hosted AWS](self-hosted-aws.md) |
| Prepare or mark a pull request ready | [Pull requests](../process/pull-requests.md) |
| Run release qualification or determine a test gate | [Testing](../../specs/engineering/testing/README.md) |
| Find the owner and precedence of a variable, secret, or provider setting | [Environment sources](../local/dev-profiles.md#environment-sources) |

Do not put secret values, deploy tokens, signing credentials, private keys, or
provider refresh tokens in documentation, PRs, issues, chat, or logs. Follow
the linked environment owner and inspect values only in the system that owns
them.
