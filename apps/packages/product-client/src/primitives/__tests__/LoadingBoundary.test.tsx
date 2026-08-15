// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
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

function renderBoundary(initial: LoadingBoundaryState) {
  return render(
    <LoadingBoundary
      state={initial}
      diagnostics={{ flow: "test" }}
      treatment={<div data-testid="treatment" />}
      emptyContent={<div data-testid="empty" />}
    >
      <div data-testid="content" />
    </LoadingBoundary>,
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
});
