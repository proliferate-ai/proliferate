/**
 * Wakes module exports.
 *
 * The service layer is the primary public API.
 * DB types and a minimal set of DB query functions are re-exported explicitly.
 */

export * from "./mapper";
export * from "./service";

// Row types and input types re-exported for consumers that need them in type position.
export type { WakeEventRow, CreateWakeEventInput } from "./db";

// DB query functions used by gateway harness and trigger-service.
// TODO: wrap these in service-layer functions and remove the re-exports.
export { createWakeEvent, findWakeEventById, hasQueuedWakeBySource } from "./db";
