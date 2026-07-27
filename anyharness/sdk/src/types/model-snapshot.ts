/**
 * Model-snapshot status wire types (model-catalog.md "The snapshot
 * reconciler" / probe-engine-design.md §4,
 * `agent_model_snapshot.rs` + `domains/agents/model_snapshot/status.rs`).
 *
 * This is a STATUS surface only (per-context counts/state/age), not a model
 * list — the enriched model rows still come from
 * `GET /v1/agents/{kind}/catalog/gateway-models`
 * (`types/agent-gateway-catalog.ts`) or the launch-options endpoint. Polling
 * this mirrors the existing `GET /v1/agents/reconcile` pattern
 * (`useAgentReconcileStatusQuery`).
 */

import type { components } from "../generated/openapi.js";

/** `idle` | `queued` | `running` | `backoff` — the probe engine's live state for one context. */
export type ModelSnapshotLiveState = components["schemas"]["ModelSnapshotLiveState"];

/** Per-auth-context probe status (never carries key/auth material on the wire). */
export type ContextStatus = components["schemas"]["ContextStatus"];

/** `GET /v1/agents/{kind}/model-snapshot` response: this agent's probe status across contexts. */
export type ModelSnapshotStatus = components["schemas"]["ModelSnapshotStatus"];
