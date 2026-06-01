# Worker Event Uplink

Status: authoritative for
`anyharness/crates/proliferate-worker/src/event_uplink/**`.

`event_uplink/` owns the AnyHarness-to-Cloud runtime event path.

```text
AnyHarness events / snapshots
  -> Worker event uplink
  -> Cloud ingest / projection read models
```

Use `event_uplink`, not `sync`. Worker does not own broad bidirectional sync.
Cloud owns projection read models; Worker owns the uplink mechanics that feed
them.

## Target Shape

```text
event_uplink/
  mod.rs
  loop.rs
  exposures.rs
  cursors.rs
  discovery.rs
  tailer.rs
  event_mapping.rs
  gaps.rs
  backfill.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing the uplink loop and test-facing types. | Event cursor or backfill implementation. |
| `loop.rs` | Boring recurring loop: fetch exposure inputs, run one pass, sleep/backoff, honor shutdown. | Event mapping, gap policy, Cloud projection rules. |
| `exposures.rs` | Fetch and interpret Cloud exposure snapshots for this worker. | Deciding exposure policy. |
| `cursors.rs` | Reconcile Cloud exposure snapshots into local event cursors and ack state. | Tailing AnyHarness or uploading batches. |
| `discovery.rs` | Discover sessions inside exposed workspaces and request backfill when Cloud lacks mappings. | Durable Cloud projection persistence. |
| `tailer.rs` | Read AnyHarness session events after the local cursor sequence. | Mapping events to Cloud payloads or deciding exposure. |
| `event_mapping.rs` | Map AnyHarness event envelopes into Worker event batch payloads for Cloud. | HTTP upload, cursor persistence, transcript reconstruction. |
| `gaps.rs` | Detect sequence gaps, report gaps to Cloud, and pause local cursors when needed. | Repairing AnyHarness history. |
| `backfill.rs` | Build and upload bounded workspace/session snapshots for exposed work. | Command lifecycle; command entry belongs in `command_downlink/handlers/backfill.rs`. |

## Flow

One uplink pass is:

```text
fetch Cloud exposure snapshot
  -> reconcile local cursors for exposed work
  -> discover missing sessions/workspace mappings
  -> backfill bounded snapshots when required
  -> tail AnyHarness events after cursor
  -> detect gaps
  -> map events to Cloud batch payload
  -> upload batch
  -> apply Cloud ack to local cursor
```

The worker store keeps cursors and mapping caches so the bridge can recover
after restart or transient Cloud failures. It is not product truth.

## Exposure And Cursor Rules

Cloud decides what should be exposed. Worker reads that decision and turns it
into local cursor work.

Worker may:

- fetch exposure snapshots from Cloud
- create/update local event cursors for exposed sessions
- pause a cursor when a sequence gap makes safe tailing impossible
- upload gap reports and event batches
- apply Cloud acknowledgements to local cursors

Worker must not:

- decide that a workspace/session should be exposed
- persist Cloud projection read models
- reconstruct transcript truth from partial events
- mutate AnyHarness state or SQLite directly

## Backfill

Backfill spans command downlink and event uplink:

```text
command_downlink/handlers/backfill.rs
  Cloud command entrypoint and result reporting

event_uplink/backfill.rs
  Snapshot discovery, bounded payload construction, and Cloud upload mechanics
```

This split keeps Cloud command lifecycle out of event mechanics while still
letting Cloud request a bounded repair.

## Hard Rules

- `loop.rs` stays boring.
- Event uplink reads AnyHarness through the AnyHarness client; it does not read
  or mutate AnyHarness SQLite directly.
- Cloud exposure policy belongs to Cloud.
- Cloud projection persistence belongs to Cloud.
- Cursor persistence belongs to `store`.
- Gap detection is visible in `gaps.rs`; do not hide it in the tailer or mapper.
- Backfill mechanics live in `event_uplink/backfill.rs`; command entry lives in
  `command_downlink/handlers/backfill.rs`.
