# Infra Area

Status: target

Terraform, deploy topology, and the managed/hand-built/dead inventory for
`server/infra/**` and `server/deploy/**`.

> [!warning]
> The Terraform state under `server/infra` was last synchronized in March; a
> plan currently proposes destroys that include live production resources
> (ALB, ECS). Do not `terraform apply` without a founder ruling. The
> re-import-vs-rebuild decision belongs to this document when it is written.

Until this area doc is written, deployment procedure lives in
[guides/deploying/](../../guides/deploying/README.md) and the release topology in
[engineering/shipping/release-delivery.md](../engineering/shipping/release-delivery.md).
