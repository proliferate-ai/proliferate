/**
 * Runtime gateway-catalog wire types (contract §2/§5, `agent_gateway_catalog.rs`).
 *
 * Folded onto the generated OpenAPI schemas: the runtime endpoints
 * (`GET /v1/agents/{kind}/catalog/gateway-models`,
 * `POST /v1/agents/{kind}/catalog/refresh-gateway`) now ride
 * `components["schemas"]` like the rest of `types/agents.ts`. The public export
 * names are kept stable for the desktop/sdk-react consumers; note the runtime
 * struct is `RefreshGatewayResponse` while the exported alias stays
 * `RefreshGatewayModelsResponse`.
 */

import type { components } from "../generated/openapi.js";

/**
 * Where a resolved gateway model list came from. The wire `source` field is a
 * plain string (`GatewayModelsResponse.source`); this narrow union documents
 * its only two values (`"seed"` = no probe yet, `"probe"` = a live probe
 * supplied the list).
 */
export type GatewayModelSource = "seed" | "probe";

/**
 * One enriched gateway model row: a catalog-known id carries the joined
 * display metadata (`displayName`/`description`/`provider`/`status`/`effort`/
 * `fastMode`); a probe-only id emits just `{ id, provider? }`.
 */
export type GatewayModelEntry = components["schemas"]["GatewayModelEntry"];

/** The thinking/effort control for a model (`values` + observed `default`). */
export type ModelEffort = components["schemas"]["ModelEffort"];

/** Resolved gateway model plan for the local surface (probe-or-seed). */
export type GatewayModelsResponse = components["schemas"]["GatewayModelsResponse"];

/** Result of a manual gateway refresh (the desktop Refresh button). */
export type RefreshGatewayModelsResponse = components["schemas"]["RefreshGatewayResponse"];
