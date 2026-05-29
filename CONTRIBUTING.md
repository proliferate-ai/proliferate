# Contribution Guide

Thanks for helping make Proliferate better.

## Start Here

Before changing code, read [docs/README.md](./docs/README.md), then read the
area doc for the part of the repo you are touching.

Examples:

- Frontend changes: [docs/frontend/README.md](./docs/frontend/README.md)
- Desktop native changes: [docs/desktop/README.md](./docs/desktop/README.md)
- Server changes: [docs/server/README.md](./docs/server/README.md)
- AnyHarness runtime changes: [docs/anyharness/README.md](./docs/anyharness/README.md)
- SDK changes: [docs/sdk/README.md](./docs/sdk/README.md)
- CI/CD or release changes: [docs/ci-cd/README.md](./docs/ci-cd/README.md)

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

PR titles and labels must follow [CI/CD docs](./docs/ci-cd/README.md): use
exactly one `release:*` label and at least one `area:*` label before marking a
PR ready for review.
