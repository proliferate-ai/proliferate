# Diagnostics collector

`proliferate-diagnostics-collector` is the standalone, memory-only consumer of
the diagnostics v1.1 contract. It owns local admission, accepted ordering,
bounded retention, query, tail, export, health, the four collector lifecycle
operations, and — in internal builds only — the provider-neutral OTLP export
adapter described below. It does not own Desktop supervision, producer routing,
support archives, or product instrumentation.

## Process interface

Start the release binary with a protected inherited capability descriptor:

```text
proliferate-diagnostics-collector \
  --capability-fd <inherited-fd> \
  [--control-fd <inherited-fd>] \
  [--release <non-secret-release>] \
  [--environment <non-secret-environment>]
```

The capability descriptor contains one newline-terminated, visible-ASCII
bearer capability and is closed after startup. The raw capability is not an
argument, environment value, URL value, descriptor field, log value, or file.
After authenticated health reports `ready`, stdout receives exactly one
non-secret JSON `ConnectionDescriptorV1` line. SIGTERM, Ctrl-C, control-channel
EOF, or `{"command":"shutdown"}` requests graceful shutdown.

The optional protected control descriptor accepts newline-delimited JSON, with
a 4,096-byte command cap:

- `{"command":"producer_dead","producer_boot_id":"..."}` supplies the
  positive death evidence required before the collector can finalize that
  producer's open lifecycle operations as `abandoned`.
- `{"command":"reset_profile_counters"}` resets workload counters for the
  release RSS proof without resetting retained data.
- `{"command":"shutdown"}` begins bounded graceful shutdown.

PR 3 may supervise this interface. It must allocate and pass the capability,
keep the raw value out of renderer state, and own restart policy; none of that
integration is present here.

## HTTP transport

The listener is always `127.0.0.1:0`. Every route requires
`Authorization: Bearer <capability>`, compares the fixed-size capability in
constant time, rejects any browser `Origin` header, and rejects a non-loopback
peer. There is no CORS or query-token path.

- `POST /v1/ingest` accepts the contract JSON batch and returns
  `IngestReceiptV1` JSON. Malformed JSON and invalid batch envelopes fail the
  request; record-level contract failures remain indexed receipt rejections.
- `GET /v1/records` returns `RecordsPageV1` JSON. Query parameters are
  `schema_version=1.1`, optional `after_cursor` and `limit`, and the filter
  field names from `RecordsFilterV1`. List filters use repeatable or
  comma-separated singular names: `component`, `record_class`, `severity`,
  `name`, and `outcome`.
- `GET /v1/tail` takes `schema_version=1.1` and optional `after_cursor`, then
  streams one `TailFrameV1` JSON object per newline. A lag frame is the final
  frame for a slow reader; the caller resumes from its cursor.
- `POST /v1/export` accepts `ExportRequestV1` JSON and streams one
  `ExportStreamFrameV1` JSON object per newline. Selection holds bounded
  references to one point-in-time view; it does not clone the retained arena or
  create a support archive.
- `GET /v1/health` returns authenticated `HealthResponseV1` JSON. Socket
  reachability establishes liveness; only `status = ready` establishes
  readiness.

Oversized requests return 413, unsupported versions return 422,
contract-invalid requests return 400, exhausted tail/export slots return 429,
and exhausted handler or startup/shutdown admission returns 503. Auth failures
do not return diagnostic detail.

The Rust raw-wire parser and receipt reason are authoritative for admission.
This pins multi-defect precedence and noncanonical numeric spellings to the
accepted Rust behavior, rejects a lone surrogate anywhere before admission,
and preserves the accepted orphan-terminal then late-start
`conflicting_terminal` result. The redundant fixture `boundary_cases` array
remains deferred to PR 12; collector tests use the exported Rust constants.

## Runtime bounds

The serialized limits remain owned by `proliferate-diagnostics-protocol`. This
process adds finite runtime caps: 64 open connections, 8 active response
handlers, 1 active request-body parser shared by ingest and export, 4 tails, 32
broadcast frames, 2 exports, 64 tracked lifecycle operations, 256 recorded
gaps, a five-second shutdown deadline, an 8 MiB encoded-record arena, and 1
MiB request-body, query-page, and tail-frame working buffers. Ingest borrows at
most 128 raw record slices from that body, stops a larger sequence before
materializing it, bounds each record's preparse tree, and retains at most 1 MiB
of prepared record encodings. The smaller operational arena leaves independent
room under the 50 MiB total RSS ceiling for indexes, query responses, tail
frames, and point-in-time export references. Whole records are always evicted
oldest first.

No record, token, descriptor, queue, or replay state is written to disk. A new
process begins with a new boot ID and only its own boot lifecycle evidence.
Standalone fallback health remains neutral, and so does exporter health in
every build of this package that is not compiled for internal dogfooding.

## Internal OTLP export

The `internal-dogfood-export` Cargo feature is off by default and is the whole
gate. A customer release builds this package with default features, so the
binary contains no destination read, queue, task, HTTP client, or credential
handling; the release job proves that by refusing to ship a bundle whose
binaries contain the endpoint variable name. Compiling the feature is necessary
but not sufficient: an internal binary still exports nothing until a
destination arrives out of band.

The destination is two environment values, both read once at startup:

```text
PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT=<https URL, or an http loopback URL>
PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS=<name=value,name=value>
PROLIFERATE_DIAGNOSTICS_DEV_TAG=<name; defaults to $USER>
```

`/v1/logs` is appended unless the endpoint already ends with it. A plaintext
endpoint is accepted only for a loopback host, so a configured credential never
crosses a network unencrypted. Provider identity and credentials live entirely
in these values; nothing in this crate names a vendor. The parsed destination
has no `Clone`, no serialization, and a `Debug` that redacts header values.
`PROLIFERATE_DIAGNOSTICS_DEV_TAG` identifies whose desktop produced a record
when teammates share one dogfood environment; it is optional and, unless both
it and `$USER` are unset or blank, is read once and attached as the `dev.user`
resource attribute.

Accepted records are offered to a bounded queue as they are accepted and
converted to OTLP/HTTP JSON logs: one resource per producer boot
(`service.name`, `service.version`, `service.instance.id`,
`deployment.environment.name`, and `dev.user` when a developer tag is
configured), one scope per admitted schema version, a detailed message or the
stable record name as the body, and every remaining contract field as a
`proliferate.*` attribute. Typed arguments become `proliferate.argument.<name>`.
A record classified `secret` is refused rather than encoded, which is a second
fence behind ingest admission rather than a new privacy path.

The export bounds are internal-only and independent of the runtime caps above:
a 512-record queue, a 128-record or 512 KiB batch, a 250 ms batch linger, a
10-second request timeout, one attempt plus two retries at 250 ms and 1 s, a
30-second cooldown after five consecutive failed batches, and a 1-second final
flush at shutdown. There is no disk outbox, replay queue, or exactly-once
protocol. An overflowing queue drops the offered record and counts it; the
offer itself is a non-blocking send on the accepting path, so a slow or failing
destination cannot delay, fail, or alter an accepted record.

`/v1/health` reports the result as `exporter.state` (`disabled`, `ready`, or
`degraded`), `exporter.dropped_records`, and
`exporter.last_error_classification`. The classification is drawn from a fixed
table — `invalid_configuration`, `encode`, `connect`, `timeout`,
`http_client_error`, `http_server_error`, `request` — and is never built from a
provider message, URL, or response body.

## Validation

Focused tests and both release-profile binaries are built from this package.
The exact long-running proof consumes the immutable profile fixture:

```text
proliferate-diagnostics-rss-profile \
  --collector-binary <same-target-release-collector> \
  --profile fixtures/contracts/rust-observability-v1/rss-profile.json \
  --target <aarch64-apple-darwin|x86_64-apple-darwin> \
  --output-dir <evidence-directory>
```

The runner writes the target, input and binary hashes, exact counters, response
latency, 250 ms RSS samples, peak RSS, security checks, and pass/fail result.

The export adapter is proved separately, and only under its feature:

```text
cargo test -p proliferate-diagnostics-collector --features internal-dogfood-export
```

`tests/otlp_dogfood.rs` runs the real collector binary as a child against a
strict local OTLP receiver that rejects any body deviating from the OTLP JSON
encoding. It establishes wire conformance, header delivery, exporter health,
and that a failing, missing, or misconfigured destination leaves ingestion and
retention untouched. It does not establish that a specific vendor accepts the
payload; no live hosted export is performed.
