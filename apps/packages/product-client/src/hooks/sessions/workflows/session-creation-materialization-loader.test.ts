import { describe, expect, it, vi } from "vitest";
import { prepareSessionCreationMaterializer } from "#product/hooks/sessions/workflows/session-creation-materialization-loader";

describe("prepareSessionCreationMaterializer", () => {
  it("does not begin durable setup when the executable chunk fails to load", async () => {
    const loadError = new TypeError("Failed to fetch dynamically imported module");
    const setupPendingCreation = vi.fn(async () => undefined);

    await expect(prepareSessionCreationMaterializer(
      { shouldSetupPendingCreation: true, setupPendingCreation },
      vi.fn(async () => { throw loadError; }),
    )).rejects.toBe(loadError);

    expect(setupPendingCreation).not.toHaveBeenCalled();
  });

  it("finishes durable setup before returning the materializer", async () => {
    const order: string[] = [];
    const materializeSessionCreation = vi.fn();
    const loadModule = vi.fn(async () => {
      order.push("loaded");
      return { materializeSessionCreation } as never;
    });

    const materializer = await prepareSessionCreationMaterializer({
      shouldSetupPendingCreation: true,
      setupPendingCreation: async () => {
        order.push("persisted");
      },
    }, loadModule);

    expect(order).toEqual(["loaded", "persisted"]);
    expect(materializer).toBe(materializeSessionCreation);
  });

  it("skips a failing local-only setup for remote empty-session creation", async () => {
    const materializeSessionCreation = vi.fn();
    const setupPendingCreation = vi.fn(async () => {
      throw new TypeError("pending recovery chunk unavailable");
    });

    await expect(prepareSessionCreationMaterializer({
      shouldSetupPendingCreation: false,
      setupPendingCreation,
    }, async () => ({ materializeSessionCreation } as never)))
      .resolves.toBe(materializeSessionCreation);

    expect(setupPendingCreation).not.toHaveBeenCalled();
  });
});
