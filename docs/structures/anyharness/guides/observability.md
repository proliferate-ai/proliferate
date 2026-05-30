# AnyHarness Observability

Status: authoritative for reusable runtime diagnostics.

## Purpose

`observability/` owns reusable tracing, latency, and measurement helpers.

This layer exists so lower runtime layers do not import diagnostics from
`api/http/**`.

Target examples:

```text
observability/latency.rs
observability/measurement.rs
observability/tracing.rs
```

## Allowed Concerns

Observability may own:

- request latency context parsed from headers
- flow id / flow kind / prompt id trace fields
- measurement operation ids
- safe debug snapshots
- small helpers for structured tracing fields

It must not own:

- product decisions
- retry behavior
- error classification beyond diagnostic labels
- HTTP response mapping

## Dependency Rule

Allowed:

```text
api -> observability
domains -> observability
live -> observability
adapters -> observability
integrations -> observability
```

Banned:

```text
observability -> api
observability -> domains
observability -> live
```
