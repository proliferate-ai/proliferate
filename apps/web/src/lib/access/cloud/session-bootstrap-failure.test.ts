import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";

import { isApiUnreachableError } from "./session-bootstrap-failure";

describe("session bootstrap failure", () => {
  it("treats HTTP error responses as reachable", () => {
    expect(isApiUnreachableError(new ProliferateClientError("Unauthorized", 401))).toBe(false);
    expect(isApiUnreachableError(new ProliferateClientError("Session expired", 440, "session_expired"))).toBe(false);
  });

  it("treats connection failures as unreachable", () => {
    expect(isApiUnreachableError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("treats timeout aborts as unreachable", () => {
    expect(isApiUnreachableError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });
});
