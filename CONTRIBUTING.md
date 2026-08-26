# Contribution Guide

Thanks for helping make Proliferate better.

## Start Here

Before changing code, read [specs/README.md](./specs/README.md), then read the
area doc for the part of the repo you are touching.

Examples:

- Frontend changes: [specs/areas/frontend.md](specs/areas/frontend.md)
- Desktop native changes: [specs/systems/desktop-host/desktop-native.md](specs/systems/desktop-host/desktop-native.md)
- Server changes: [specs/areas/server.md](specs/areas/server.md)
- AnyHarness runtime changes: [specs/areas/anyharness.md](specs/areas/anyharness.md)
- SDK changes: [specs/areas/frontend.md](specs/areas/frontend.md)
- CI/CD or release changes: [guides/deploying/README.md](./guides/deploying/README.md)

## Local Development

```bash
make install
make dev-local
```

For full-stack local development, use named profiles:

```bash
make server-install
make setup PROFILE=<name>
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make dev-list
make run PROFILE=<name>
```

Give every worktree its own profile name. To reuse an existing Postgres or
Redis service, or to develop from Windows through WSL2, follow the
[local-development procedure](./guides/local/README.md).

## Pull Requests

Follow the [pull-request procedure](./guides/process/pull-requests.md)
to prepare a focused PR, record proof, choose its metadata, and mark it ready
for review.
