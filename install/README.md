# Proliferate Install Assets

This directory holds file assets that ship into managed environments at build
or bootstrap time. It no longer contains an interactive installer: the SSH
target onboarding surface (and its `proliferate-target-install.sh` shell
installer) was deleted, and managed cloud never ran a shell installer — managed
cloud bootstrap writes worker and supervisor config directly inside the
sandbox. Every managed-cloud launch is unconditionally Supervisor-owned: it
launches Supervisor detached, and Supervisor starts AnyHarness and Worker
itself. See
[`specs/FEATURE_DOCS/MANAGED_RUNTIME.md`](../specs/FEATURE_DOCS/MANAGED_RUNTIME.md#launch-topology-by-surface)
for the current launch flow and
[`specs/supervisor.md`](../specs/supervisor.md)
for what Supervisor owns as the parent process.

## `proliferate-git-credential-helper`

A POSIX sh git credential helper for sandboxes. The managed-cloud template
build copies it to `~/.proliferate/bin/proliferate-git-credential-helper`
inside the sandbox image, and materialization configures git to call it so
clones and fetches read the current GitHub lease instead of a baked-in token.
[`specs/FEATURE_DOCS/SANDBOX/github-auth.md`](../specs/FEATURE_DOCS/SANDBOX/github-auth.md)
owns the credential flow;
[`specs/FEATURE_DOCS/SANDBOX/content.md`](../specs/FEATURE_DOCS/SANDBOX/content.md)
describes the sandbox content layout it lands in.
