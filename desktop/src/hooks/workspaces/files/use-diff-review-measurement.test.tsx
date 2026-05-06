// @vitest-environment jsdom

import { AnyHarnessRuntime } from "@anyharness/sdk-react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { AnyHarnessQueryTimingOptions } from "@anyharness/sdk-react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDebugMeasurementDump,
  resetDebugMeasurementForTest,
} from "@/lib/infra/debug-measurement";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/files/use-diff-review-measurement";

describe("useDiffReviewMeasurement", () => {
  afterEach(() => {
    cleanup();
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("starts a bounded diff review sample and cleans up on unmount", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");

    const rendered = renderHook(() => useDiffReviewMeasurement(), {
      wrapper: createWrapper(),
    });

    expect(rendered.result.current.operationId).not.toBeNull();
    expect(getDebugMeasurementDump().activeOperations).toHaveLength(1);

    rendered.unmount();

    expect(getDebugMeasurementDump().activeOperations).toHaveLength(0);
  });

  it("starts a real sample after React StrictMode's probe remount", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");

    const rendered = renderHook(() => useDiffReviewMeasurement(), {
      wrapper: createStrictWrapper(),
    });

    expect(rendered.result.current.operationId).not.toBeNull();
    expect(getDebugMeasurementDump().activeOperations).toHaveLength(1);
  });

  it("defers query mounting until first request options include lifecycle attribution", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const observedQueryOptions: boolean[] = [];

    function QueryMountProbe() {
      const measurement = useDiffReviewMeasurement();
      if (measurement.deferQueryMount) {
        return null;
      }
      return (
        <RequestOptionsProbe
          options={measurement.diffTimingOptions}
          observedQueryOptions={observedQueryOptions}
        />
      );
    }

    render(<QueryMountProbe />, {
      wrapper: createWrapper(),
    });

    expect(observedQueryOptions).toEqual([true]);
  });

  it("does not defer query mounting when measurement is disabled", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "0");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "0");
    const observedQueryOptions: boolean[] = [];
    const observedDeferrals: boolean[] = [];

    function QueryMountProbe() {
      const measurement = useDiffReviewMeasurement();
      if (measurement.deferQueryMount) {
        observedDeferrals.push(true);
        return null;
      }
      return (
        <RequestOptionsProbe
          options={measurement.diffTimingOptions}
          observedQueryOptions={observedQueryOptions}
        />
      );
    }

    render(<QueryMountProbe />, {
      wrapper: createWrapper(),
    });

    expect(observedDeferrals).toEqual([]);
    expect(observedQueryOptions).toEqual([false]);
  });

  it("does not keep a long-mounted all changes sample open indefinitely", () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");

    const rendered = renderHook(() => useDiffReviewMeasurement(), {
      wrapper: createWrapper(),
    });

    expect(getDebugMeasurementDump().activeOperations).toHaveLength(1);
    expect(
      new Headers(rendered.result.current.diffTimingOptions.requestOptions?.headers)
        .has("x-proliferate-measurement-operation-id"),
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1_001);
    });

    expect(getDebugMeasurementDump().activeOperations).toHaveLength(0);
    expect(rendered.result.current.operationId).toBeNull();
    expect(
      new Headers(rendered.result.current.diffTimingOptions.requestOptions?.headers)
        .has("x-proliferate-measurement-operation-id"),
    ).toBe(false);
  });
});

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AnyHarnessRuntime runtimeUrl="http://runtime.test">
        {children}
      </AnyHarnessRuntime>
    );
  };
}

function createStrictWrapper() {
  const RuntimeWrapper = createWrapper();
  return function StrictWrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <RuntimeWrapper>{children}</RuntimeWrapper>
      </StrictMode>
    );
  };
}

function RequestOptionsProbe({
  options,
  observedQueryOptions,
}: {
  options: AnyHarnessQueryTimingOptions;
  observedQueryOptions: boolean[];
}) {
  const requestOptions = options.requestOptions;
  const headers = new Headers(requestOptions?.headers);
  observedQueryOptions.push(
    Boolean(requestOptions?.measurementOperationId)
      && Boolean(requestOptions?.timingLifecycle?.onRequestStart)
      && headers.has("x-proliferate-measurement-operation-id"),
  );
  return null;
}
