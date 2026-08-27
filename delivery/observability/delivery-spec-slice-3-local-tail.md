# Delivery specification — observability slice O-3: the local tail + the link scheme (frozen)

Chain position: slice 3 of the observability build-out; independent of O-2, consumes O-1 nothing and #2264's file sinks (worker.log / supervisor.log) plus the collector's existing local surface. Evidence of record: the observability system spec rewrite (branch `obs/system-spec`, delta rows 15–16, §3 Flow 5), Pablo's 2026-08-26 rulings: the collector is the canonical local log system with files as fallback; one logs home including local-dev `server.log`; the verb is `proliferate logs`.

## Intent

One command shows everything that happened on this machine, across every process, time-ordered, filterable to one session — the local twin of the production story page — and one server helper renders the five production story links from one session id, so nobody hand-assembles a link again.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

With the desktop app running locally, run `proliferate logs --follow`, use the app for a minute, and watch one interleaved, time-ordered stream carrying anyharness, worker, supervisor, collector-held records, and (when the local dev server runs) server lines. Run `proliferate logs --session <the session you just used>` and see only that session's story, lifecycle records included. Falsifier: a running process's lines absent from the stream, ordering visibly wrong across sources, or the session filter missing records the collector holds for that id. Link half: `session_links(<id>)` returns the five URLs and the runs-triage surface (or a unit render) consumes them verbatim.

## Scope

Spec sections of record: observability README §1 (runtime-emitter and server-spine doors) · §2 Data (the log record, key custody untouched) · §3 Flow 5 (one id becomes the story) · §4 cells 1–2 (the tail verb, the logs home, `session_links`).

- **The verb** — a `logs` subcommand on the anyharness clap CLI (`anyharness/src/cli.rs` + `commands/logs.rs`), surfaced to humans as `proliferate logs` (the desktop bundles the binary; a `proliferate` alias ships when the CLI wrapper exists — the subcommand is the deliverable, the alias is packaging). Flags: `--session <uuid>`, `--level <min>`, `--since <duration|ts>`, `--follow`, `--dir <logs home override>`.
- **Sources + merge** — collector-first: discover the local collector via its existing connection descriptor, read `/v1/records` (bounded backfill) and `/v1/tail` (follow) with the capability token; merge with the file sinks (`anyharness.log`, `worker.log`, `supervisor.log`, `server.log`) by parsed timestamp with a stable tiebreak; a missing or unreadable source degrades loudly to the remaining sources (one line saying what is absent), never silently.
- **Session filtering** — collector records filter on their `session_id` correlation field; file lines filter on the JSON `session_id` key when the line is JSON, and are excluded (with a summary count) when text lines cannot carry the filter — text is for humans reading unfiltered.
- **The server sink** — local dev only (`debug=true`): the existing handler setup in `middleware/logging.py` adds a rotating `server.log` file handler writing the same JSON records into the logs home (`PROLIFERATE_LOGS_HOME` env, defaulting beside the runtime home); prod path (stdout → CloudWatch) untouched.
- **The link scheme** — `session_links(session_id)` in the server spine (one module, five URL builders: app session page, Sentry `session_id:{id}` tag search in the server project, Honeycomb `anyharness` dataset query on `proliferate.session_id`, CloudWatch Logs Insights filter, support-reports search), returned as a typed dict; consumed this slice by one unit-rendered usage; the runs-triage surface adopts it in its own spec's build.

## Non-goals (deliberately out)

A desktop debug-view UI over the same stream · cloud-sandbox log custody (seam deferral) · log shipping of any kind · server-side lifecycle records · changing any sink format (#2264 owns formats).

## Proof

- Merge tests over fixture files + a fixture record set: global ordering, stable tiebreak, `--since`/`--level` windows, the degraded-source line.
- Session-filter tests: collector records by correlation field; JSON lines by key; text-line exclusion counted.
- Follow test: a line appended to a sink and a record ingested mid-stream both appear, ordered.
- `session_links` unit tests: five URLs, exact scheme, UUID-only input enforced.
- Live half, recorded in the PR: a transcript of the acceptance-gate run on a dev machine.

## Discharges

Observability README delta rows 15 (the tail verb + server.log sink) and 16 (the link scheme).
