# Infra

Infrastructure code (Pulumi, Helm, Terraform) for running Proliferate in the cloud.

- Spec: `SPEC.md`
- Docs: https://docs.proliferate.com/self-hosting/overview

## Directories

- `pulumi-k8s`: AWS (EKS) Kubernetes deployment via Pulumi.
- `pulumi-k8s-gcp`: GCP (GKE) Kubernetes deployment via Pulumi.
- `helm`: Helm chart(s) consumed by Pulumi stacks.
- `terraform`: Legacy/manual infrastructure (being migrated).
- `pulumi`: Legacy Pulumi experiments and examples.
