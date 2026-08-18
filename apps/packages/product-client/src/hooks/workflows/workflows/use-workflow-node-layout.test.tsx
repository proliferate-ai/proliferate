// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowNodeLayout } from "#product/hooks/workflows/workflows/use-workflow-node-layout";

const items = new Map<string, string>();

// One stable object, as the real facade guarantees: a fresh context per
// render would re-run the hydrate effect forever.
const storageContext = {
  storage: {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: async (key: string) => {
      items.delete(key);
    },
  },
  captureException: () => {},
};

vi.mock("#product/hooks/persistence/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => storageContext,
}));

const LAYOUT_KEY = "workflow_node_layout";

beforeEach(() => {
  items.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useWorkflowNodeLayout", () => {
  it("hydrates a saved workflow's placements and writes back after the move settles", async () => {
    items.set(LAYOUT_KEY, JSON.stringify({ "wf-1": { "step-1": { x: 5, y: 5 } } }));
    const { result } = renderHook(() => useWorkflowNodeLayout("wf-1"));

    await waitFor(() => expect(result.current.placements).toEqual({ "step-1": { x: 5, y: 5 } }));

    act(() => result.current.moveNode("step-1", { x: 40, y: 60 }));
    expect(result.current.placements).toEqual({ "step-1": { x: 40, y: 60 } });
    // Nothing is written mid-drag; only where the drag ends is worth storing.
    expect(JSON.parse(items.get(LAYOUT_KEY)!)["wf-1"]).toEqual({ "step-1": { x: 5, y: 5 } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(JSON.parse(items.get(LAYOUT_KEY)!)["wf-1"]).toEqual({ "step-1": { x: 40, y: 60 } });
  });

  it("keeps a draft's arrangement when the first save mints its id", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useWorkflowNodeLayout(id),
      { initialProps: { id: null as string | null } },
    );

    act(() => result.current.moveNode("step-1", { x: 12, y: 34 }));
    rerender({ id: "wf-new" });

    expect(result.current.placements).toEqual({ "step-1": { x: 12, y: 34 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(JSON.parse(items.get(LAYOUT_KEY)!)["wf-new"]).toEqual({ "step-1": { x: 12, y: 34 } });
  });

  it("writes the last move out when the author leaves inside the settle window", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string | null }) => useWorkflowNodeLayout(id),
      { initialProps: { id: "wf-1" as string | null } },
    );

    act(() => result.current.moveNode("step-1", { x: 90, y: 12 }));
    // Switching away cancels the trailing timer; the move it owed still has to
    // reach storage, or leaving is how an author loses their last placement.
    rerender({ id: "wf-2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(JSON.parse(items.get(LAYOUT_KEY)!)["wf-1"]).toEqual({ "step-1": { x: 90, y: 12 } });

    act(() => result.current.moveNode("step-9", { x: 5, y: 6 }));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(JSON.parse(items.get(LAYOUT_KEY)!)["wf-2"]).toEqual({ "step-9": { x: 5, y: 6 } });
  });

  it("starts clean on a different workflow rather than carrying the last one's", async () => {
    items.set(LAYOUT_KEY, JSON.stringify({ "wf-2": { "step-1": { x: 7, y: 7 } } }));
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useWorkflowNodeLayout(id),
      { initialProps: { id: "wf-1" as string | null } },
    );

    act(() => result.current.moveNode("step-1", { x: 300, y: 300 }));
    rerender({ id: "wf-2" });

    await waitFor(() => expect(result.current.placements).toEqual({ "step-1": { x: 7, y: 7 } }));
  });
});
