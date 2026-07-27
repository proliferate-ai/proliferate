/**
 * Model-snapshot status wire types (model-catalog.md "Runtime routes",
 * `agent_model_snapshot.rs` + `domains/agents/model_snapshot/status.rs`).
 *
 * One composed observation per harness: the status carries the observation's
 * `probedAt`/age, the engine's live state and ownership mode, the provenance
 * fields, and the `models`/`modes` arrays off the same document read. There is
 * no per-context map and no `authContextId` anywhere on this surface. Polling
 * this mirrors the existing `GET /v1/agents/reconcile` pattern
 * (`useAgentReconcileStatusQuery`).
 */

import type { components } from "../generated/openapi.js";

/** `idle` | `queued` | `running` | `backoff` — the probe engine's live state for one harness. */
export type ModelSnapshotLiveState = components["schemas"]["ModelSnapshotLiveState"];

/** `GET /v1/agents/{kind}/model-snapshot` response: this harness's composed probe status. */
export type ModelSnapshotStatus = components["schemas"]["ModelSnapshotStatus"];
