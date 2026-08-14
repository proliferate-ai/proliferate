import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkflowsV2Enabled, resolveWorkflowsV2Enabled } from "./workflows-v2";

// Both postures of the compiled-in default are injected rather than read from
// WORKFLOWS_V2_DEFAULT: asserting against the constant's current value would
// assert nothing (and would break on the rung that flips it), while injecting
// both proves the override wins in each direction.
describe("resolveWorkflowsV2Enabled", () => {
  it("is off with the default off and no override", () => {
    expect(resolveWorkflowsV2Enabled({ defaultEnabled: false })).toBe(false);
  });

  it("is on with the default on and no override", () => {
    expect(resolveWorkflowsV2Enabled({ defaultEnabled: true })).toBe(true);
  });

  it("forces on with \"1\" while the default is off", () => {
    expect(resolveWorkflowsV2Enabled({ defaultEnabled: false, viteWorkflowsV2: "1" })).toBe(true);
  });

  it("forces off with \"0\" while the default is on", () => {
    expect(resolveWorkflowsV2Enabled({ defaultEnabled: true, viteWorkflowsV2: "0" })).toBe(false);
  });

  it.each([" 1 ", "1\n"])("trims surrounding whitespace around %j", (value) => {
    expect(resolveWorkflowsV2Enabled({ defaultEnabled: false, viteWorkflowsV2: value })).toBe(true);
  });

  it.each([undefined, "", " ", "true", "false", "on", "off", "yes", "no", "2"])(
    "defers %j to the default",
    (value) => {
      expect(resolveWorkflowsV2Enabled({ defaultEnabled: false, viteWorkflowsV2: value })).toBe(false);
      expect(resolveWorkflowsV2Enabled({ defaultEnabled: true, viteWorkflowsV2: value })).toBe(true);
    },
  );
});

// The wrapper is what production calls, so the kill switch is proved end to
// end through `import.meta.env` — including that it carries no dev-mode
// condition, since these cases run under the same mode either way. Neither
// case asserts the shipped default, so both survive the rung that flips it.
describe("isWorkflowsV2Enabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads \"1\" from the environment as forced on", () => {
    vi.stubEnv("VITE_WORKFLOWS_V2", "1");

    expect(isWorkflowsV2Enabled()).toBe(true);
  });

  it("reads \"0\" from the environment as forced off", () => {
    vi.stubEnv("VITE_WORKFLOWS_V2", "0");

    expect(isWorkflowsV2Enabled()).toBe(false);
  });
});
