# Contribution Guide

Thanks for helping make Proliferate better.

## Before You Change the Repository

Start with [`AGENTS.md`](./AGENTS.md). It contains the repository-wide
invariants and the single source-area and cross-plane task router. Follow every
owner document it selects for your change; use
[`specs/README.md`](./specs/README.md) when you need the documentation authority
and lifecycle model.

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

Give every worktree its own profile name. For constrained hosts, reuse of an
existing Postgres or Redis service, or development from Windows through WSL2,
follow the [local-development procedure](./guides/local/README.md).

## Pull Requests

Follow the [pull-request procedure](./guides/process/pull-requests.md)
to prepare a focused PR, record proof, choose its metadata, and mark it ready
for review.
