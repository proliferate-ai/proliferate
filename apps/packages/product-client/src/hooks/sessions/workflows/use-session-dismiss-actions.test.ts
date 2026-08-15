import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { isSessionAlreadyGone } from "#product/hooks/sessions/workflows/use-session-dismiss-actions";

describe("isSessionAlreadyGone", () => {
  it("treats a runtime 404 as an already-dismissed session", () => {
    const error = new AnyHarnessError({ title: "Not found", status: 404 });
    expect(isSessionAlreadyGone(error)).toBe(true);
  });

  it("keeps other runtime failures as real dismissal failures", () => {
    expect(isSessionAlreadyGone(new AnyHarnessError({ title: "Boom", status: 500 }))).toBe(false);
    expect(isSessionAlreadyGone(new Error("network down"))).toBe(false);
    // The SDK only exposes HTTP status on AnyHarnessError.problem; a flat
    // status property belongs to its telemetry projection, not this path.
    expect(isSessionAlreadyGone(Object.assign(new Error("x"), { status: 404 }))).toBe(false);
  });
});
