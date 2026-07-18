import { describe, expect, it, vi } from "vitest";
import type { SessionStreamHandle } from "@anyharness/sdk";
import { isExpectedSessionStreamStaleCloseError } from "@proliferate/product-domain/telemetry/session-stream-stale-close";

import { closeStaleSessionStreamHandle } from "#product/hooks/sessions/lifecycle/session-stream-handle";

describe("closeStaleSessionStreamHandle", () => {
  it("marks only the ownership boundary for stale connection cleanup", () => {
    const close = vi.fn();
    const handle: SessionStreamHandle = { close };

    closeStaleSessionStreamHandle(handle);

    expect(close).toHaveBeenCalledOnce();
    expect(isExpectedSessionStreamStaleCloseError(close.mock.calls[0]?.[0])).toBe(true);
  });
});
