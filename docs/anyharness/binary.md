# Binary Crate

`anyharness/crates/anyharness/src/**` is the executable shell for the runtime.

## Allowed Location

- `anyharness/crates/anyharness/src/**`

## Owns

- process entrypoint
- tracing initialization
- CLI arg parsing
- subcommand dispatch
- server startup wiring
- OpenAPI printing commands

## Must Not Own

- domain models
- database queries
- route definitions
- ACP protocol logic
- agent install logic
- workspace orchestration
- session lifecycle rules

## Expected Shape

- `main.rs`
  - initialize tracing
  - parse CLI args
  - dispatch to a command module
- `cli.rs`
  - `clap` structs and enums only
- `commands/*.rs`
  - bootstrap a command
  - delegate to `anyharness-lib`

## Current Command Map

- `serve`
  - choose runtime home
  - ensure directories exist
  - open DB
  - build `AppState`
  - build and serve the router
- `print-openapi`
  - render OpenAPI JSON to stdout

## Rule of Thumb

If a binary command needs to know how sessions, agents, files, or workspaces
actually work, that logic belongs in `anyharness-lib`.

The binary crate is allowed to compose services and choose startup policy. It is
not allowed to become a second runtime implementation.
