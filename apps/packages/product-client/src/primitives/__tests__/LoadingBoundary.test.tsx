// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import {
  LoadingBoundary,
  type LoadingBoundaryState,
} from "#product/primitives/LoadingBoundary";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const { showDelayMs, minDisplayMs } = motion.loading;

let emitted: RendererDiagnosticInput[];

beforeEach(() => {
  vi.useFakeTimers();
  emitted = [];
  setRendererDiagnosticsSink({ emit: (input) => emitted.push(input) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetRendererDiagnosticsSinkForTest();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function names(): string[] {
  return emitted.map((entry) => entry.name);
}

function fieldsOf(name: string): Record<string, unknown> {
  const record = emitted.find((entry) => entry.name === name);
  if (!record?.fields) {
    throw new Error(`no record emitted for ${name}`);
  }
  return Object.fromEntries(
    Object.entries(record.fields).map(([key, field]) => [key, field.value]),
  );
}

function boundary(state: LoadingBoundaryState, child?: ReactNode) {
  return (
    <LoadingBoundary
      state={state}
      diagnostics={{ flow: "test" }}
      treatment={<div data-testid="treatment" />}
      emptyContent={<div data-testid="empty" />}
    >
      {child ?? <div data-testid="content" />}
    </LoadingBoundary>
  );
}

function renderBoundary(initial: LoadingBoundaryState) {
  return render(boundary(initial));
}

function countOf(name: string): number {
  return names().filter((entry) => entry === name).length;
}

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button data-testid="counter" onClick={() => setN((v) => v + 1)}>
      {n}
    </button>
  );
}

describe("LoadingBoundary", () => {
  it("never mounts a treatment when the wait resolves under the show delay", () => {
    const { rerender, queryByTestId } = renderBoundary("pending");

    // A promise resolving at 50ms: still inside the 200ms show-delay window.
    advance(50);
    expect(queryByTestId("treatment")).toBeNull();

    rerender(
      <LoadingBoundary
        state="ready"
        diagnostics={{ flow: "test" }}
        treatment={<div data-testid="treatment" />}
      >
        <div data-testid="content" />
      </LoadingBoundary>,
    );

    // Advance well past both windows: the treatment must never have appeared.
    advance(showDelayMs + minDisplayMs + 100);

    expect(queryByTestId("treatment")).toBeNull();
    expect(queryByTestId("content")).not.toBeNull();
    expect(names()).toContain("renderer.loading.treatment_suppressed");
    expect(names()).not.toContain("renderer.loading.treatment_shown");
  });

  it("renders empty only after resolve and holds the treatment for the min-display floor", () => {
    const { rerender, queryByTestId } = renderBoundary("pending");

    // Cross the show-delay so the treatment mounts.
    advance(showDelayMs);
    expect(queryByTestId("treatment")).not.toBeNull();
    expect(queryByTestId("empty")).toBeNull();
    expect(names()).toContain("renderer.loading.treatment_shown");

    // Data resolves to empty immediately after the treatment mounted.
    rerender(
      <LoadingBoundary
        state="empty"
        diagnostics={{ flow: "test" }}
        treatment={<div data-testid="treatment" />}
        emptyContent={<div data-testid="empty" />}
      >
        <div data-testid="content" />
      </LoadingBoundary>,
    );

    // Inside the min-display hold: empty must not have replaced the treatment.
    advance(minDisplayMs - 1);
    expect(queryByTestId("treatment")).not.toBeNull();
    expect(queryByTestId("empty")).toBeNull();

    // Once the hold elapses, empty (and only empty) renders.
    advance(1);
    expect(queryByTestId("treatment")).toBeNull();
    expect(queryByTestId("empty")).not.toBeNull();
    expect(queryByTestId("content")).toBeNull();

    const settled = fieldsOf("renderer.loading.settled");
    expect(settled.resolution).toBe("empty");
    expect(settled.min_display_ms).toBe(minDisplayMs);
  });

  it("keeps a single, identity-stable treatment across the pending window", () => {
    const { queryAllByTestId, queryByTestId } = renderBoundary("pending");

    advance(showDelayMs);
    const first = queryByTestId("treatment");
    expect(first).not.toBeNull();

    // Time passes while still pending: no second treatment, same node instance.
    advance(1000);
    expect(queryAllByTestId("treatment")).toHaveLength(1);
    expect(queryByTestId("treatment")).toBe(first);
    expect(
      names().filter((name) => name === "renderer.loading.treatment_shown"),
    ).toHaveLength(1);
  });

  it("re-arms the show-delay on a second pending cycle (slow resolve honors min-display)", () => {
    const { rerender, queryByTestId } = renderBoundary("pending");

    // Cycle 1: cross show-delay, resolve ready, let the hold elapse.
    advance(showDelayMs);
    expect(queryByTestId("treatment")).not.toBeNull();
    rerender(boundary("ready"));
    advance(minDisplayMs);
    expect(queryByTestId("content")).not.toBeNull();
    expect(queryByTestId("treatment")).toBeNull();
    expect(countOf("renderer.loading.treatment_shown")).toBe(1);
    expect(countOf("renderer.loading.settled")).toBe(1);

    // Cycle 2: the SAME mounted instance re-enters pending. It must re-arm the
    // show-delay, not fall through to stale content.
    rerender(boundary("pending"));
    expect(queryByTestId("content")).toBeNull();
    expect(queryByTestId("treatment")).toBeNull();

    // Inside the second show-delay window: still nothing.
    advance(showDelayMs - 1);
    expect(queryByTestId("treatment")).toBeNull();

    // Crossing it mounts the treatment again and fires diagnostics a 2nd time.
    advance(1);
    expect(queryByTestId("treatment")).not.toBeNull();
    expect(countOf("renderer.loading.treatment_shown")).toBe(2);

    // Slow resolve: the second cycle honors its own min-display floor.
    rerender(boundary("ready"));
    advance(minDisplayMs - 1);
    expect(queryByTestId("treatment")).not.toBeNull();
    expect(queryByTestId("content")).toBeNull();
    advance(1);
    expect(queryByTestId("content")).not.toBeNull();
    expect(queryByTestId("treatment")).toBeNull();
    expect(countOf("renderer.loading.settled")).toBe(2);
  });

  it("suppresses a fast second resolve after a first full cycle", () => {
    const { rerender, queryByTestId } = renderBoundary("pending");

    // Cycle 1: full treatment + min-display hold.
    advance(showDelayMs);
    rerender(boundary("ready"));
    advance(minDisplayMs);
    expect(countOf("renderer.loading.treatment_shown")).toBe(1);
    expect(countOf("renderer.loading.treatment_suppressed")).toBe(0);

    // Cycle 2: re-enter pending, then resolve inside the show-delay window.
    rerender(boundary("pending"));
    advance(50);
    rerender(boundary("ready"));
    advance(showDelayMs + minDisplayMs + 100);

    // The fast second resolve must suppress: no new treatment ever mounts.
    expect(queryByTestId("treatment")).toBeNull();
    expect(queryByTestId("content")).not.toBeNull();
    expect(countOf("renderer.loading.treatment_shown")).toBe(1);
    expect(countOf("renderer.loading.treatment_suppressed")).toBe(1);

    const suppressed = fieldsOf("renderer.loading.treatment_suppressed");
    // Elapsed is measured from the second cycle's fresh start, not cycle 1.
    expect(suppressed.elapsed_ms as number).toBeLessThan(showDelayMs);
  });

  it("preserves resolved child identity across reveals (no key remount)", () => {
    const { rerender, getByTestId } = render(boundary("ready", <Counter />));

    // The stateful child mounted at reveal; mutate its state.
    fireEvent.click(getByTestId("counter"));
    fireEvent.click(getByTestId("counter"));
    expect(getByTestId("counter").textContent).toBe("2");

    // A resolved-phase re-render must not remount the child (which would reset
    // its state to 0). The fade restarts on a stable wrapper, not via a key.
    rerender(boundary("ready", <Counter />));
    expect(getByTestId("counter").textContent).toBe("2");

    // The reveal still carries the one sanctioned fade class.
    expect(
      getByTestId("counter").parentElement?.classList.contains(
        "animate-content-fade-in",
      ),
    ).toBe(true);
  });
});
