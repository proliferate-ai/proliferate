# Performance Profiling

This runbook captures a dev-only latency baseline. It is measurement-only:
do not combine these numbers with selector changes, state splits,
virtualization, or reducer rewrites in the same PR.

## Flags

Use only the new privacy-safe measurement flags:

```bash
VITE_PROLIFERATE_DEBUG_MAIN_THREAD=1
VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING=1
```

Do not enable `VITE_PROLIFERATE_DEBUG_LATENCY` for privacy-clean baseline
runs. Existing workflow latency logs can include ids, URLs, and paths.

## Start A Profile

For a fresh profile:

```bash
make dev-init PROFILE=latency
VITE_PROLIFERATE_DEBUG_MAIN_THREAD=1 \
VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING=1 \
make dev PROFILE=latency
```

Rows printed by the measurement logger are dev-build rows. The logger prints
both a `console.table` and a `[measurement_summary_json]` line for the same
operation. Prefer saving the JSON lines because browser tables can hide columns
when copied. Treat React counts as StrictMode-inflated unless a separate
production-like profiling build says otherwise. Each summary row labels:

- `devBuild: true`
- `strictMode: true`
- `longTaskObserverSupported: true | false`

## Export A Slow-State Dump

When the app becomes slow after it has been running for a while, do not reload
first. Open the webview console and run:

```js
proliferateDebugMeasurement.export()
```

This downloads a privacy-safe JSON dump with recent sanitized measurement
metrics, finished summaries, active operations, and renderer memory counters.
The profiler also samples renderer heap counters every five seconds while the
debug flags are enabled, so the dump can show whether memory climbed before the
slowdown.
For a quick in-console object instead of a file:

```js
proliferateDebugMeasurement.dump()
```

The dump intentionally stores ids, counts, categories, durations, surfaces, and
hashed runtime scopes only. It must not contain prompts, transcript text, paths,
repo names, raw URLs, request bodies, response bodies, or SSE payloads.

## Baseline Flows

Capture each flow separately and keep the console summary rows:

- local workspace open
- session switch
- session history hydrate/reconcile after opening an existing session
- long transcript stream sample
- composer typing burst
- transcript scroll
- file tree expand
- file tree scroll
- send/stop/header/sidebar hover
- session rename
- local workspace rename
- cloud workspace list/rename only when cloud is active

Cloud rows are control-plane timing, not AnyHarness runtime timing.

## Reading Rows

The row is intentionally strict and count-based. Every operation has an
`overall` row plus breakdown rows when data exists:

- `request` rows: sanitized AnyHarness/cloud category, method, status, count,
  total duration, max duration
- `workflow` rows: local orchestration substeps such as workspace bootstrap,
  session history replay/store, stream setup, session selection, and resume
  substeps like target resolution, workspace metadata fetch, and MCP launch
  resolution
- `surface` rows: React commits, render counts, long tasks, and frame gaps by
  named UI surface
- `stream` rows: connect, first-event, event dispatch, close/abort/error
  phases
- `state_count` rows: event, turn, and item counts before/after a history or
  stream apply, plus fetched history event counts
- `cache`, `reducer`, and `store` rows: cache decisions and reducer/store apply
  costs by category

The `overall` row still includes:

- request counts and max/total request duration
- stream first-event time, event count, malformed count, and max event gap
- cache hit/miss/stale/skipped counts
- reducer/store apply counts and max/total duration
- React commit count, max commit, and total commit time
- render count
- long-task and frame-gap counts/max duration

## Session Apply Diagnostics

For transcript rehydration and live stream apply cost, look for these operation
kinds:

- `session_history_initial_hydrate`: full history fetch/replay/store/commit for
  a session that did not have cached transcript state.
- `session_history_tail_reconcile`: `afterSeq` catch-up work after hot reopen or
  reconnect.
- `session_history_older_chunk`: older transcript chunk loaded while scrolling
  upward.
- `session_stream_event_batch`: reducer/store/commit work caused by incoming
  SSE events, grouped by short idle windows.
- `workspace_background_reconcile`: post-hot-paint workspace/session/file
  reconciliation.

Use the `workflow` rows to separate fetch time from `session.history.replay`,
`session.history.store`, and `session.history.mount_subagents`. Use the
`state_count` rows to understand the input size, especially
`session.history.events_fetched`, `session.history.events_before`,
`session.history.events_after`, `session.history.turns_after`, and
`session.history.items_after`. A slow parent `workspace_background_reconcile`
with a slow child `session_history_tail_reconcile` usually means the expensive
work is transcript apply/commit, not workspace selection itself.

Rows must not contain prompts, transcript text, terminal output, raw errors,
file contents, file names, repo names, workspace/session titles, paths, raw
URLs, endpoint paths, query strings, request/response bodies, or SSE payloads.
