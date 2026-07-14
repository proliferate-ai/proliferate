# CI/CD

This path is retained as a compatibility router. It does not own a workflow
inventory, environment catalog, pull-request policy, or long-form operator
procedure.

## Source Of Truth

| Question | Owner |
| --- | --- |
| What artifacts, coordinates, workflows, and sequencing exist? | [Delivery system](../../codebase/systems/engineering/delivery/README.md) |
| How do I deploy hosted staging or production? | [Hosted deployments](hosted.md) |
| How do I run a train, hotfix, or artifact release? | [Releases](releases.md) |
| How do I install or update self-hosting? | [Compose](self-hosted-deploy.md) or [AWS](self-hosted-aws.md) |
| How do I prepare a PR and choose its title or labels? | [Pull requests](../process/pull-requests.md) |
| What qualification is required before release? | [Testing](../testing/README.md) |
| Where does a variable or secret live? | [Environment sources](../reference/environment-sources.md) and the [variable catalog](../reference/env-vars.yaml) |
| How does the installed Desktop updater behave? | [Desktop Updates](../../codebase/systems/engineering/delivery/desktop-updates.md) |
| How is Web/Desktop unification being rolled out? | [Web/Desktop rollout](web-desktop-unification-rollout.md) |

When automation and prose disagree, verify the checked-in workflow or source
at the exact revision and update its owning document. Do not copy the corrected
fact into this router.
