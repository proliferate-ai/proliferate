# Delivery System

- [Desktop Updates and Release Notices](desktop-updates.md) — packaged updater
  behavior and release notices.
- [Release Manifest Schema](release-manifest.schema.json) — machine-readable
  desktop release metadata contract.

Contributor release procedures live under
[Developing: Deploying](../../../../developing/deploying/README.md).

[Observability](../observability/README.md) consumes Delivery's component
artifact identity as the Sentry `release` and structured-log `release_id`;
provider event production does not redefine release identity.
