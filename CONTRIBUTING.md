# Contribution Guide

Thanks for helping make Proliferate better.

## Start Here

Before changing code, read [docs/README.md](./docs/README.md), then read the
area doc for the part of the repo you are touching.

Examples:

- Frontend changes: [docs/structures/frontend/README.md](./docs/structures/frontend/README.md)
- Desktop native changes: [docs/structures/desktop-native/README.md](./docs/structures/desktop-native/README.md)
- Server changes: [docs/structures/server/README.md](./docs/structures/server/README.md)
- AnyHarness runtime changes: [docs/structures/anyharness/README.md](./docs/structures/anyharness/README.md)
- SDK changes: [docs/structures/sdk/README.md](./docs/structures/sdk/README.md)
- CI/CD or release changes: [docs/dev/ci-cd.md](./docs/dev/ci-cd.md)

## Local Development

```bash
make install
make dev-local
```

For full-stack local development, use named profiles:

```bash
make server-install
make dev-init PROFILE=main
make dev-list
make dev PROFILE=main
```

## Pull Requests

Keep PRs focused and leave unrelated files alone.

PR titles and labels must follow [CI/CD docs](./docs/dev/ci-cd.md): use
exactly one `release:*` label and at least one `area:*` label before marking a
PR ready for review.
