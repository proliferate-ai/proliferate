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

## Span Doctrine

How runtime code emits diagnostics, regardless of layer:

- One `#[tracing::instrument]` span per use-case entry, with fields declared
  once. Everything inside — events, errors, child calls — inherits them.
- Phase timings are span events, not hand-rolled `Instant::now()` pairs with
  repeated field blocks.
- **Observability context never appears in a function signature.** Request
  latency/flow context is parsed from headers at the transport edge, attached
  to the request span, and propagates through span context — never as a
  `latency: Option<&LatencyRequestContext>` parameter or struct field.
- Hand-copying the same field cluster (`flow_id`/`flow_kind`/`flow_source`/
  `prompt_id`) across multiple `tracing::` calls in one file is the symptom
  that a span is missing. Copy-pasted clusters drift; spans cannot.
- Log where an error is handled, not at every hop it passes through.

Migration exception: the sessions startup/prompt paths currently thread
`LatencyRequestContext` through ~13 signatures across api -> domains -> live
and relay it via actor config/command fields, with the field cluster
hand-copied in 10+ call sites. Target: one request span at the edge, child
spans per use case, events for phases.

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
