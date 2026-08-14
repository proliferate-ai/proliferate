# Rust observability

Description: a Desktop-owned, authenticated, bounded diagnostics stream and a provider-neutral canonical lifecycle vocabulary shared with server structured logs.
Date: 2026-08-10
Status: approved; implementation is tracked by the thirteen-slice registry below.

## Orientation

Version 1 makes a running Proliferate Desktop installation legible across its
owned process boundaries. An agent or CLI can eventually ask one authenticated
local service what happened, follow new evidence, export a bounded snapshot,
and determine whether the evidence itself is healthy. The same lifecycle
vocabulary is used in the server's existing structured logs so local and hosted
continuations can correlate without making the local collector a server log
backend.

The outcomes are:

1. Detailed evidence from the renderer, Tauri host, bundled AnyHarness, and
   Desktop Worker is queryable as one ordered local stream with explicit gaps
   and producer health.
2. An existing support flow can provide an agent a recent, re-scrubbed snapshot
   only after explicit per-submission customer consent.
3. Important operations have stable `started`/terminal evidence that
   distinguishes success, failure, cancellation, timeout, abandonment,
   rejection, and intentional skipping.

This is not an analytics redesign. Sentry remains the exception and crash
surface. PostHog product analytics and anonymous telemetry remain unchanged.
Server detailed logs continue through the current structured-log path to
Grafana/CloudWatch. No dashboard, alert, or PostHog runtime-health path is part
of this decision.

## Current context

Before this decision, Desktop native, renderer diagnostics, bundled AnyHarness,
and Desktop-launched Worker had separate file/stdout paths with no shared
cross-process record contract or ordered query surface. Server observability
had structured logging, Sentry, PostHog, and anonymous telemetry, but no shared
detailed-record/canonical-lifecycle distinction. `anyharness-contract` owns the
AnyHarness public HTTP/SSE/WebSocket API and is not the owner of a Desktop
diagnostics protocol.

Cross-language JSON contracts already use golden fixtures under
`fixtures/contracts/`, with every represented producer and consumer checking
the same serialized meaning. This decision follows that rule with a separate
protocol-only Rust crate plus pure ProductClient and server representations.

## Decision

### Version 1 boundary

The local collector covers only the process tree owned by Desktop:

```text
Desktop/Tauri (owner)
  -> diagnostics collector sidecar
  -> bundled AnyHarness
  -> Desktop Worker
  -> renderer, through the Tauri bridge
```

Tauri will start and own a standalone collector process before bundled
AnyHarness or Desktop Worker. The collector is not embedded in AnyHarness.
Standalone AnyHarness, managed runtimes, cloud workers, supervisors, remote
targets, and arbitrary user processes do not connect in v1. The hosted server
does not send detailed records to the collector; it emits its owned lifecycle
records through its existing structured-log path.

### Two record classes

Every record envelope has exactly one payload class.

- A detailed diagnostic record is local investigation evidence: structured
  logs, span events, messages, typed arguments, error detail, stdout/stderr
  adapter records, token/item deltas, heartbeats, progress, milestones, loss
  summaries, or transport observations. It can be high-volume and can contain
  non-secret customer content needed for local diagnosis. It does not imply an
  operation began or ended.
- A canonical lifecycle record is a low-volume semantic statement. One
  operation emits `started` and exactly one terminal outcome: `succeeded`,
  `failed`, `cancelled`, `timed_out`, `abandoned`, `rejected`, or `skipped`.
  Progress and milestones never become extra terminals.

Exactly one terminal is a semantic invariant, not an exactly-once delivery
promise. Stable operation IDs and producer sequences expose retry and loss. An
identical terminal retry is a duplicate. A conflicting second terminal is
rejected and counted as a health violation. After a producer boot is known
dead, the collector may synthesize only `abandoned`, preserving the original
producer/operation identity and declaring `finalizer = collector`. It never
infers `failed` from text.

A structurally valid orphan terminal remains the terminal that arrived. The
collector makes the missing start diagnosable through a gap/health violation;
it does not invent a start or failure.

### Versioned envelope and bounds

The provider-neutral wire format is JSON schema version `1.1`. A v1.1
collector accepts producer minors `1.1` and `1.0`; the exact previous-producer
minor window is one. Unknown optional fields are ignored, and a known optional
field set to JSON `null` is normalized to absence. Unknown majors,
future minors, incompatible shapes, prohibited fields, and over-limit values
fail closed with stable rejection reasons. Retained records preserve the
version admitted, and query/export manifests report versions present.

Producers own source timestamp, sequence, boot/component/source,
release/environment, owned or received correlation IDs, stable name, severity,
typed arguments, privacy/redaction classification, error classification, and
payload. The collector alone owns accepted timestamp/order, retention cursor,
duplicate/conflict accounting, and collector-finalized abandonment.

Typed arguments are tagged scalar, enum, bounded list, or bounded object
values. The v1 constants are:

| Bound | Value |
| --- | ---: |
| JSON integer magnitude | 9,007,199,254,740,991 |
| Record / batch | 65,536 bytes / 1,048,576 bytes and 128 records |
| Generic string / detailed message / name / ID | 4,096 / 16,384 / 128 / 128 UTF-8 bytes |
| Arguments / list items / object fields / nesting depth | 32 / 32 / 32 / 4 |
| Filter values / default page / maximum page | 32 / 100 / 500 |
| Tail-frame records | 128 |
| Export | 10,000 records and 33,554,432 bytes |
| Cardinality entries / versions present / producer-health entries | 256 / 16 / 64 |
| Total collector RSS / retained-record arena | 52,428,800 / 33,554,432 bytes |

The RSS ceiling is total process resident memory, not retained payload bytes.
The lower arena cap leaves room for queues, indexes, tails, exports, and
process overhead. `fixtures/contracts/rust-observability-v1/rss-profile.json`
fixes release builds, warm-up, concurrent ingest/query/tail/export, oversized
input, a slow reader, a failed exporter, 250 ms sampling, evidence, and
pass/fail steps for `aarch64-apple-darwin` and `x86_64-apple-darwin`. PR 2 must
execute that profile; PR 1 only validates its completeness.

### Closed P0 lifecycle catalog

This table is complete. Brace notation expands only to the named members. No
operation may be added, renamed, split, moved, or assigned another semantic
owner without renewed founder approval.

| Stable operation family | Sole semantic owner | Start and terminal boundary | Owning PR |
| --- | --- | --- | --- |
| `collector.{boot,shutdown,export}`; `collector.producer.attach` | Collector service | Collector initialization/shutdown/export/registration begins → readiness, orderly stop, snapshot completion, or admission/rejection is known. | 2 |
| `desktop.collector.{start,restart,stop}`; `desktop.anyharness_process.{start,restart,stop}`; `desktop.worker_process.{start,stop}` | Tauri process supervisor | Supervisor accepts the process action → child ready/stopped or action fails, times out, is rejected/cancelled/abandoned. | 3 |
| `desktop.application.boot`; `desktop.authentication.{restore,login,logout}`; `desktop.workspace.{create,open,close}`; `desktop.target.{create,connect,disconnect,teardown}`; `desktop.prompt.submit`; `desktop.update.{check,download,verify,install,relaunch}` | Desktop/ProductClient application service accepting the intent | Intent accepted/boot begins → client orchestration finishes or hands an accepted prompt to AnyHarness, or reaches an allowed terminal. | 8 |
| `desktop.support_snapshot.{prepare,submit}` | Existing Desktop support workflow | After per-export consent, preparation/submission begins → bounded artifact/receipt or allowed terminal. | 6 |
| `anyharness.runtime.{boot,shutdown}`; `anyharness.workspace.{create,open,close}`; `anyharness.target.{create,connect,disconnect,teardown}`; `anyharness.session.{create,restore}`; `anyharness.turn.execute`; `anyharness.agent.{start,handshake,request,terminate}`; `anyharness.stream`; `anyharness.model.request`; `anyharness.{tool,mcp,plugin,skill,hook,subagent}.invoke`; `anyharness.{permission,user_interaction}.request`; `anyharness.{goal,autonomous_loop,review,workflow}.run`; `anyharness.persistence.migrate` | Desktop-bundled AnyHarness semantic use case or adapter that begins the work | Owner admits the work → semantic/protocol result, including cancellation, timeout, rejection, skip, observable unwind, transport loss, or abandonment. | 9 |
| `desktop_worker.{boot,shutdown,runtime_connect,command_execute}` | Desktop-launched Worker service or command owner | Initialization/shutdown/connect/admitted command begins → ready/stopped/connected/result or allowed terminal. | 9 |
| `server.http.request`; `server.sse.stream`; `server.websocket.connection`; `server.gateway.forward` | Owning server transport | Request/connection/forward admitted → transport completes/closes/resolves or reaches an allowed transport terminal; never terminalizes domain work. | 10 |
| `server.workspace.{provision,teardown}`; `server.sandbox.{provision,teardown}`; `server.runtime.{enroll,converge,update,decommission}`; `server.worker.dispatch`; `server.workflow.run`; `server.integration.{connect,sync}`; `server.authentication.{exchange,refresh}`; `server.support_report.{submit,process}`; `server.job.execute`; `server.outbox.deliver`; `server.webhook.{handle,deliver}`; `server.model_gateway.request` | Owning server domain service; model gateway only when it constructs and owns the provider request | Owner admits orchestration/attempt/run/delivery/request → committed/known domain result, including allowed terminals and worker loss. | 11 |

Routine CRUD, list/get/search/settings actions, database queries, cache
mechanics, healthy polls, heartbeats, updater chunks, token/item deltas,
progress, UI interactions, attach/detach observations, gaps, and overload
samples remain detailed/health evidence. They do not receive bespoke lifecycle
pairs.

### Semantic ownership

The semantic owner emits lifecycle meaning. A transport or adapter emits only
its own operation and never restates or infers carried domain work. Tauri owns
child process actions; AnyHarness owns turns and tool/plugin/model adapter work;
server HTTP/SSE/WebSocket/gateway surfaces own transport only. A server gateway
owns `server.model_gateway.request` only when it constructs and owns the
provider request.

Model/plugin lifecycle metadata is limited to an already-owned stable ID,
safe kind/category, phase, duration, and model token counts. Prompt, response,
tool arguments/results, raw payloads, provider responses, commands, and paths
are prohibited there. Non-secret customer detail remains available in local
detailed records; the lifecycle restriction is not a blanket content-removal
policy.

### Authenticated loopback API

The future sidecar binds only to `127.0.0.1` on an OS-assigned port. Tauri owns
a random per-boot capability and passes only a protected token reference plus
endpoint, schema major, and collector boot ID to owned processes. The raw token
is memory-only or in a protected inherited channel. It is never persisted,
logged, placed in a URL or support metadata, or exposed to renderer JavaScript.
Every route requires bearer authentication with constant-time comparison and
rejects cross-origin browser access. Renderer/agent/CLI access is mediated by
narrow Tauri-owned operations.

The v1 surfaces are:

- `POST /v1/ingest`: bounded batch and receipt with accepted range,
  duplicates, rejections, and pressure;
- `GET /v1/records`: bounded filters/page, cursors, gaps, and versions;
- `GET /v1/tail`: record batches plus explicit lag and gap frames, disconnecting
  slow readers instead of growing queues;
- `POST /v1/export`: bounded point-in-time request and manifest/record/gap/
  health/end stream frames; support purpose requires explicit authorization;
- `GET /v1/health`: cursors, pressure, retention, evictions, rejection and
  oversize counts, duplicate/conflicting terminals, per-producer sequence/gaps/
  liveness, tail drops, exporter state, and fallback state.

There is no human diagnostics UI in v1.

### Retention, routing, and privacy

The collector is memory-only. At arena pressure it evicts whole records
oldest-first regardless of severity/class, advances the oldest cursor, and
emits exact counters and gaps. It never blocks product work for retention.
There is no collector database, disk outbox, replay queue, or exactly-once
protocol. Bounded non-blocking producers drop detailed before lifecycle records,
count loss, and resume after outages without replaying arbitrary history.

Customer builds keep full detail and lifecycle evidence local. They contain no
normal Honeycomb credential or direct background export path. Internal/dogfood
builds may best-effort export accepted non-secret records through a
provider-neutral OTLP adapter to the current internal Honeycomb destination;
provider identity and credentials remain outside this contract. Provider
failure never changes local ingestion or product behavior.

Support reuses the existing support-report flow. Only explicit per-submission
consent permits a bounded point-in-time snapshot, collector/Worker health, and
a second purpose-specific secret scrub. The consent surface says that selected
records may contain customer content. Scrubbing removes credentials,
authorization material, cookies, private keys, access/refresh tokens,
environment values, keychain content, and detected secrets, but does not
silently remove all non-secret prompts, transcripts, tool/terminal/file/path,
or provider detail.

Server detailed records and server lifecycle records remain in the current
structured-log route. Sentry, PostHog, and anonymous telemetry do not move.

### Failure rules

Observability never changes a product operation's result. Producer emission,
collector retention, and internal export are bounded best effort. Missing
evidence is represented by counters, gaps, and health—not by a fabricated
product failure. Collector crash does not terminate product processes. An
explicit diagnostics API request such as export returns its own failure
honestly, without changing the underlying product operation.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Keep independent broad log files | No single ordered cross-process view, no explicit gaps/health, and duplicate stores remain. |
| Embed the collector in AnyHarness | It cannot start first or survive an AnyHarness restart under Tauri ownership. |
| Persist a collector DB or disk outbox | Violates bounded memory-only v1 and introduces durability/replay semantics not required for diagnosis. |
| Treat detailed logs as lifecycle events | Volume and implementation churn destroy the stable exactly-one-terminal semantic layer. |
| Let transports infer domain outcomes | Creates duplicate or false ownership, especially across HTTP/SSE/WebSocket and agent streams. |
| Continuously export customer detail | Violates the local-first and explicit per-submission consent boundary. |
| Couple the schema to Honeycomb | Makes a current internal destination part of the product contract instead of a replaceable OTLP adapter. |
| Build a human diagnostics UI | Agents and CLI/API consumers are the v1 surface; a UI adds a separate product scope. |

## Implementation slice registry

The decision sections above are frozen. This registry tracks thirteen
independently reviewed slices; a later slice may not pull work forward from an
earlier owner.

| PR | Slice | Dependency | Contract gate |
| ---: | --- | --- | --- |
| 1 | Normative ADR, versioned contracts, and golden fixtures | Approved base | Land this ADR, protocol-only Rust crate, pure TypeScript/Python representations, shared fixtures, and the release RSS profile; no runtime behavior. |
| 2 | Standalone collector core | 1 | Authenticated loopback, bounded memory/query/tail/export/health, collector-owned lifecycle, and RSS execution. |
| 3 | Tauri packaging, supervision, and query seam | 2 | Tauri owns startup/auth/readiness/restart/shutdown and never exposes the raw token. |
| 4 | Desktop renderer structured diagnostics | Develop from 1; complete on 3 | One bounded renderer detail path with tiny outage-only native fallback; no lifecycle expansion. |
| 5 | Bundled AnyHarness and Desktop Worker adapters | 4 (transitively 3) | Desktop-bundled modes only; bounded queues/reconnect and one primary detail path. |
| 6 | Consented support snapshot | 3; restack on 5 if needed | Per-submission consent, bounded scrubbed snapshot, health, and existing support attachment path only. |
| 7 | Provider-neutral internal OTLP exporter and dogfood proof | 5 | Internal/dogfood only, bounded best effort, no customer credentials or provider-coupled contract. |
| 8 | Desktop application lifecycle semantics | 4, integrate on 5 | Instrument exactly the Desktop application operations assigned by the P0 table. |
| 9 | AnyHarness and Desktop Worker lifecycle semantics | 8 and 5 | Instrument exactly their assigned semantic owners; safe model/plugin metadata only. |
| 10 | Server canonical emitter and transport propagation | 1 | Server-native shape; HTTP/SSE/WebSocket/gateway own transport and propagate correlation only. |
| 11 | Server core domain lifecycle | 10 plus approved 9 correlation contract | Instrument exactly server domain owners; no transport duplication or new log store. |
| 12 | Instrumentation standard and coverage checker | Integrated 1–11 | Reconcile current-state owner docs and add pinning checks without new exceptions. |
| 13 | Agent instructions | 12 | Route agents to landed owners/checks without duplicating the normative contract; final slice. |

PR 1 hands the immutable collector protocol to PR 2 and the lifecycle/logging
vocabulary to PRs 4–11. Contract changes return to PR 1 ownership and require
dependent slices to restack.

## Validation

The v1 contract is accepted only when Rust, TypeScript, and Python parse and
serialize the same valid fixtures and reject every invalid fixture for the
pinned reason. Tests cover both record classes, all terminal outcomes,
duplicate versus conflict, producer-death abandonment, orphan terminals,
version skew, unknown optional fields, prohibited secret/model/plugin fields,
every API shape, exact P0 catalog parity, bounds, and RSS-profile completeness.

Decision provenance: founder-approved feature specification
`sha256:f1d94921140392ae32bcea83b6c2eb19c3c07d6d9b5847aa9b57c47f639b3d6c`;
approved roadmap
`sha256:b280208eaeb7395eee4f95885615087a666b3a3c996e3344c94408e5fb48a365`.
