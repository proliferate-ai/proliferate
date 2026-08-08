# Contribution Guide

Thanks for helping make Proliferate better.

## Start Here

Before changing code, read [specs/README.md](./specs/README.md), then read the
area doc for the part of the repo you are touching.

Examples:

- Frontend changes: [specs/frontend/README.md](specs/frontend/README.md)
- Desktop native changes: [specs/desktop-native.md](specs/desktop-native.md)
- Server changes: [specs/server/standards.md](specs/server/standards.md)
- AnyHarness runtime changes: [specs/anyharness/README.md](specs/anyharness/README.md)
- SDK changes: [specs/sdk.md](specs/sdk.md)
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
