/**
 * Composer-submit agent-catalog readiness gate (UX Latency ADR §4.6, Rung 10 /
 * Q12).
 *
 * Rung 10 takes the agent catalog off the blocking workspace-switch bootstrap
 * and warms it in the background from selection entry (see
 * `run-workspace-selection.ts`). A send that materializes a session still needs
 * the catalog to resolve launch model registries and defaults, so submit is the
 * single place that awaits catalog readiness. Because the catalog is prefetched
 * in parallel with the connection/directory chain, this await is normally
 * already resolved; when it is not, the send waits here rather than the switch.
 *
 * The gate falls back to `null` on failure so a catalog error never blocks a
 * submit — the caller then resolves launch config from the bundled defaults.
 */
export async function resolveSubmitAgentCatalog<T>(
  ensureCloudAgentCatalog: () => Promise<T>,
): Promise<T | null> {
  return ensureCloudAgentCatalog().catch(() => null);
}
