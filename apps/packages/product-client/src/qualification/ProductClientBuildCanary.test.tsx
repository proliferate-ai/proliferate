import { describe, expect, it } from "vitest";

// Proves the vitest `#product/*` resolution wiring: the public shell canary loads
// through the package-private alias (mapped to source under test). It intentionally
// does NOT render, so React.lazy never invokes the dynamic import of the
// authenticated canary — keeping this test hermetic (no font/CSS/design build
// required). The real asset-emission proof lives in the host Vite builds (S2).
describe("ProductClientBuildCanary", () => {
  it("resolves the public shell canary through the #product import", async () => {
    const mod = await import("#product/qualification/ProductClientBuildCanary");

    expect(typeof mod.ProductClientBuildCanary).toBe("function");
  });
});
