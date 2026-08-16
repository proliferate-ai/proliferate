import { describe, expect, it, vi } from "vitest";
import { resolveSubmitAgentCatalog } from "#product/lib/domain/agents/agent-catalog-submit-gate";

// UX Latency ADR §4.6, Rung 10 (Q12): submit is the single gate that awaits
// agent-catalog readiness. Rung 10 warms the catalog in the background from
// workspace-selection entry, so this gate is normally already resolved; when it
// is not, submit waits here rather than the switch.
describe("resolveSubmitAgentCatalog (composer-submit catalog gate)", () => {
  it("awaits catalog readiness before resolving", async () => {
    let resolveCatalog: ((value: { agents: [] }) => void) | null = null;
    const ensureCloudAgentCatalog = vi.fn(
      () => new Promise<{ agents: [] }>((resolve) => {
        resolveCatalog = resolve;
      }),
    );

    const gate = resolveSubmitAgentCatalog(ensureCloudAgentCatalog);
    let settled = false;
    void gate.then(() => {
      settled = true;
    });

    // Not yet loaded: the gate stays pending until the catalog settles.
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveCatalog?.({ agents: [] });
    await expect(gate).resolves.toEqual({ agents: [] });
  });

  it("falls back to null when the catalog fetch fails, so submit is never blocked", async () => {
    const ensureCloudAgentCatalog = vi.fn(() =>
      Promise.reject(new Error("catalog offline")),
    );
    await expect(
      resolveSubmitAgentCatalog(ensureCloudAgentCatalog),
    ).resolves.toBeNull();
  });
});
