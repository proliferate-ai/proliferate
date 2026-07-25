import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient, hashAppQueryKey } from "./query-client";

describe("hashAppQueryKey", () => {
  it("hashes plain query keys with sorted object fields", () => {
    expect(hashAppQueryKey(["cloud", { repo: "b", owner: "a" }])).toBe(
      '["cloud",{"owner":"a","repo":"b"}]',
    );
  });

  it("does not recurse forever on cyclic query keys", () => {
    const value: { id: string; self?: unknown } = { id: "cycle" };
    value.self = value;

    expect(hashAppQueryKey(["workspace", value])).toBe(
      '["workspace",{"id":"cycle","self":"[Circular]"}]',
    );
  });

  it("summarizes non-plain objects instead of traversing browser objects", () => {
    const event = new Event("click");

    expect(hashAppQueryKey(["event", event])).toBe('["event","[Event]"]');
  });
});

describe("createAppQueryClient", () => {
  it("delegates unhandled query errors to the injected product transport", async () => {
    const captureException = vi.fn();
    const client = createAppQueryClient(captureException);
    const error = new Error("query failed");

    await expect(client.fetchQuery({
      queryKey: ["workspace", "workspace-1"],
      queryFn: async () => {
        throw error;
      },
      retry: false,
    })).rejects.toBe(error);

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "query_error",
        domain: "react_query",
      },
      extras: {
        query_hash: '["workspace","workspace-1"]',
      },
    });
  });

  it("preserves telemetryHandled suppression", async () => {
    const captureException = vi.fn();
    const client = createAppQueryClient(captureException);

    await expect(client.fetchQuery({
      queryKey: ["handled"],
      queryFn: async () => {
        throw new Error("handled");
      },
      meta: { telemetryHandled: true },
      retry: false,
    })).rejects.toThrow("handled");

    expect(captureException).not.toHaveBeenCalled();
  });
});
