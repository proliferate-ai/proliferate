import { describe, expect, it } from "vitest";
import { resolveProductAuthRequired } from "./auth-mode";

describe("resolveProductAuthRequired", () => {
  it("requires auth by default for production desktop builds", () => {
    expect(
      resolveProductAuthRequired({
        viteDev: false,
        proliferateEnvironment: "production",
      }),
    ).toBe(true);
  });

  it("keeps local development auth optional by default", () => {
    expect(
      resolveProductAuthRequired({
        viteDev: true,
        proliferateEnvironment: "development",
      }),
    ).toBe(false);
  });

  it("allows explicit production opt out", () => {
    expect(
      resolveProductAuthRequired({
        viteDev: false,
        viteRequireAuth: "false",
        proliferateEnvironment: "production",
      }),
    ).toBe(false);
  });

  it("allows explicit dev opt in", () => {
    expect(
      resolveProductAuthRequired({
        viteDev: true,
        viteRequireAuth: "true",
        proliferateEnvironment: "development",
      }),
    ).toBe(true);
  });
});
