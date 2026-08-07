# Moved

This document moved to [specs/server/README.md](../../../server/README.md),
which now carries its type-pipeline rationale and transaction discipline as
first-class sections.

Its remaining sections are owned by the current documents they duplicated:

- Layer law, per-folder practices, and dependency direction:
  [specs/server/standards.md](../../../server/standards.md) and the focused
  server files it routes to.
- <a id="5-managed-runtime-and-worker-detailed"></a>Managed runtime and Worker
  (launch topology, the `supervisor_owned_runtime` asymmetry, enrollment and
  heartbeat convergence):
  [sandbox-lifecycle.md](../../platforms/product/sandbox-lifecycle.md) and
  [proliferate-worker/README.md](../proliferate-worker/README.md).
- Cloud to runtime flow and its non-atomicity:
  [workspace-provisioning.md](../../platforms/product/workspace-provisioning.md).
- DB model conventions and current model families:
  [specs/server/database.md](../../../server/database.md).
