# Contribution Guide

Thanks for helping make Proliferate better.

## Start Here

Before changing code, read [specs/README.md](./specs/README.md), then read the
area doc for the part of the repo you are touching.

Examples:

- Frontend changes: [specs/codebase/structures/frontend/README.md](./specs/codebase/structures/frontend/README.md)
- Desktop native changes: [specs/codebase/structures/desktop-native/README.md](./specs/codebase/structures/desktop-native/README.md)
- Server changes: [specs/codebase/structures/server/README.md](./specs/codebase/structures/server/README.md)
- AnyHarness runtime changes: [specs/codebase/structures/anyharness/README.md](./specs/codebase/structures/anyharness/README.md)
- SDK changes: [specs/codebase/structures/sdk/README.md](./specs/codebase/structures/sdk/README.md)
- CI/CD or release changes: [specs/developing/deploying/ci-cd.md](./specs/developing/deploying/ci-cd.md)

## Local Development

```bash
make install
make dev-local
```

For full-stack local development, use named profiles:

```bash
make server-install
make setup PROFILE=main
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make dev-list
make run PROFILE=main
```

## Pull Requests

Keep PRs focused and leave unrelated files alone.

PR titles and labels must follow [CI/CD specs](./specs/developing/deploying/ci-cd.md): use
exactly one `release:*` label and at least one `area:*` label before marking a
PR ready for review.
