# Proliferate Install Assets

This directory holds file assets that ship into managed environments at build
or bootstrap time. It no longer contains an interactive installer: the SSH
target onboarding surface (and its `proliferate-target-install.sh` shell
installer) was deleted, and managed cloud never ran a shell installer — managed
cloud bootstrap writes worker and supervisor config directly inside the
sandbox. Every managed-cloud launch is unconditionally Supervisor-owned: it
launches Supervisor detached, and Supervisor starts AnyHarness and Worker
itself. See
[`specs/systems/harnesses/managed-runtime.md`](../specs/systems/harnesses/managed-runtime.md#launch-topology-by-surface)
for the current launch flow and
[`specs/areas/anyharness.md`](../specs/areas/anyharness.md)
for what Supervisor owns as the parent process.

## `proliferate-git-credential-helper`

A POSIX sh git credential helper for sandboxes. The managed-cloud template
build copies it to `~/.proliferate/bin/proliferate-git-credential-helper`
inside the sandbox image, and materialization configures git to call it so
clones and fetches read the current GitHub lease instead of a baked-in token.
[`specs/systems/github/sandbox-github-auth.md`](../specs/systems/github/sandbox-github-auth.md)
owns the credential flow;
[`specs/systems/environments/README.md`](../specs/systems/environments/README.md)
describes the sandbox content layout it lands in.
