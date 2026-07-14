/* @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  productHostWrapper,
  makeTestProductHost,
  testAuthState,
} from "@/test/product-host-test-utils";
import { useSupportAvailability } from "./use-support-availability";

function wrapperForStatus(status: "loading" | "anonymous" | "authenticated") {
  return productHostWrapper(
    makeTestProductHost({ authState: testAuthState(status) }),
  );
}

describe("useSupportAvailability", () => {
  it("allows submit only when authenticated", () => {
    const { result } = renderHook(() => useSupportAvailability(), {
      wrapper: wrapperForStatus("authenticated"),
    });
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.disabledReason).toBeNull();
  });

  it("blocks (with a reason) when anonymous", () => {
    const { result } = renderHook(() => useSupportAvailability(), {
      wrapper: wrapperForStatus("anonymous"),
    });
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.disabledReason).toMatch(/sign in/i);
  });

  it("blocks WITHOUT a reason while bootstrapping (no premature flash)", () => {
    const { result } = renderHook(() => useSupportAvailability(), {
      wrapper: wrapperForStatus("loading"),
    });
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.disabledReason).toBeNull();
  });
});
