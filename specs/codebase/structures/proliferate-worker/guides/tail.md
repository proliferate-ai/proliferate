# Worker Event Tail

Status: authoritative for
`anyharness/crates/proliferate-worker/src/tail/**`.

`tail/` owns the up-channel: AnyHarness runtime events → Cloud projection. It is
a **dumb pump** — it forwards the normalized event stream; it does not reshape
events or own projection truth.

```text
AnyHarness events
  -> Worker tail (per exposed session, after the up-cursor)
  -> Cloud ingest / projection read models -> client fan-out
```

Named `tail/`, not `sync/` — the worker does not own bidirectional sync, and
config convergence is `control/reconcile`, a different thing. Cloud owns
projection read models; the worker owns the tail mechanics that feed them.

## Target Shape

```text
tail/
  mod.rs
  loop.rs
  cursors.rs
  mapping.rs
  backfill.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing the tail loop and test-facing types. | Cursor or backfill implementation. |
| `loop.rs` | Boring recurring loop: for each exposed session, run one pass, sleep, honor shutdown. | Event mapping, gap policy, Cloud projection rules. |
| `cursors.rs` | The up-cursor (`last_uploaded_seq`), ack application, contiguous-seq tracking, and gap detection. | Tailing AnyHarness or uploading batches. |
| `mapping.rs` | Map AnyHarness event envelopes into worker event-batch payloads. | HTTP upload, cursor persistence, transcript reconstruction. |
| `backfill.rs` | Build and upload bounded workspace/session snapshots for exposed work. | Command lifecycle; the command entry lives in `control/commands/handlers/backfill.rs`. |

## Flow

The set of exposed sessions comes from `control/reconcile` (the `exposures`
domain), not a tail-local exposure poll. One tail pass per exposed session:

```text
pull AnyHarness events since last_uploaded_seq (via anyharness_client)
  -> map to a Cloud batch payload
  -> POST /events/batches
  -> advance the cursor to the acked contiguous seq
  -> on a sequence gap: pause the cursor and request a bounded backfill
```

The worker store keeps the up-cursor so the bridge recovers after a restart or
a transient Cloud failure. It is not product truth. Ingest is idempotent on the
Cloud side (dedup by seq/hash), so an at-least-once re-send is safe.

## What Tail May And May Not Do

Tail may:

- pull AnyHarness events after the up-cursor
- map and upload event batches
- advance the cursor to the acked contiguous seq
- detect a gap, pause the cursor, and request a bounded backfill

Tail must not:

- decide that a workspace/session should be exposed (that is Cloud's policy,
  delivered via `control/reconcile`)
- persist Cloud projection read models
- reconstruct transcript truth from partial events
- mutate AnyHarness state or SQLite directly

## Backfill

Backfill spans the two channels:

```text
control/commands/handlers/backfill.rs   Cloud command entrypoint + result report
tail/backfill.rs                        snapshot discovery, bounded payload, upload
```

This keeps command lifecycle out of event mechanics while still letting Cloud
request a bounded repair.

## Hard Rules

- `loop.rs` stays boring.
- Tail reads AnyHarness through `anyharness_client`; it never reads or mutates
  AnyHarness SQLite directly.
- Exposure policy belongs to Cloud and arrives via `control/reconcile`; tail
  does not poll exposures itself.
- Cloud projection persistence belongs to Cloud.
- Up-cursor persistence belongs to `store`.
- Gap detection is visible in `cursors.rs`; do not hide it in the mapper.
- Backfill mechanics live here; the command entry lives in `control/commands`.
