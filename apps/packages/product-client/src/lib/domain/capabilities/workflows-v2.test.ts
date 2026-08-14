import { describe, expect, it } from "vitest";
import { resolveWorkflowsV2Enabled } from "./workflows-v2";

// `resolveWorkflowsV2Enabled` takes the env as a plain argument rather than
// reading `import.meta.env` itself, precisely so these cases don't need
// `import.meta.env` stubbing (matching how auth-mode.test.ts tests
// `resolveProductAuthRequired` rather than `isProductAuthRequired`).
describe("resolveWorkflowsV2Enabled", () => {
  it("is off by default outside dev, with no override", () => {
    expect(resolveWorkflowsV2Enabled({ dev: false })).toBe(false);
  });

  it("is off by default in dev, with no override", () => {
    expect(resolveWorkflowsV2Enabled({ dev: true })).toBe(false);
  });

  it("stays off outside dev even with the override set", () => {
    expect(resolveWorkflowsV2Enabled({ dev: false, viteWorkflowsV2: "true" })).toBe(false);
  });

  it("turns on in dev when the override is truthy", () => {
    expect(resolveWorkflowsV2Enabled({ dev: true, viteWorkflowsV2: "true" })).toBe(true);
  });

  it.each(["0", "false", "off", "no", ""])(
    "treats override value %j as still disabled",
    (value) => {
      expect(resolveWorkflowsV2Enabled({ dev: true, viteWorkflowsV2: value })).toBe(false);
    },
  );

  it.each(["1", "TRUE", "on", "yes", "anything-else"])(
    "treats override value %j as enabled",
    (value) => {
      expect(resolveWorkflowsV2Enabled({ dev: true, viteWorkflowsV2: value })).toBe(true);
    },
  );
});
