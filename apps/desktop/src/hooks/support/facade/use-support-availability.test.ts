/* @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useSupportAvailability } from "./use-support-availability";

vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  return {
    useProductHost: () => {
      const status = useAuthStore((state) => state.status);
      return {
        auth: {
          state: status === "bootstrapping"
            ? { status: "loading" as const }
            : status === "authenticated"
              ? { status: "authenticated" as const, user: null, readiness: { status: "ready" as const } }
              : { status: "anonymous" as const, methods: [] },
        },
      };
    },
  };
});

const initial = useAuthStore.getState();

afterEach(() => {
  useAuthStore.setState(initial, true);
});

describe("useSupportAvailability", () => {
  it("allows submit only when authenticated", () => {
    useAuthStore.setState({ status: "authenticated" });
    const { result } = renderHook(() => useSupportAvailability());
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.disabledReason).toBeNull();
  });

  it("blocks (with a reason) when anonymous", () => {
    useAuthStore.setState({ status: "anonymous" });
    const { result } = renderHook(() => useSupportAvailability());
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.disabledReason).toMatch(/sign in/i);
  });

  it("blocks WITHOUT a reason while bootstrapping (no premature flash)", () => {
    useAuthStore.setState({ status: "bootstrapping" });
    const { result } = renderHook(() => useSupportAvailability());
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.disabledReason).toBeNull();
  });
});
