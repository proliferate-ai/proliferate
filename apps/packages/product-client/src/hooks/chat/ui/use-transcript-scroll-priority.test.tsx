// @vitest-environment jsdom

import { Suspense, startTransition, useState } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_USER_SCROLL_SETTLE_MS,
  useTranscriptScrollPriority,
} from "./use-transcript-scroll-priority";

interface Snapshot {
  revision: number;
}

describe("useTranscriptScrollPriority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a stable snapshot across stream updates while user scrolling is active", () => {
    let latestValue: Snapshot = { revision: 1 };
    const rendered = renderHook(() => useTranscriptScrollPriority({
      latestValue,
      scopeKey: "workspace:session",
    }));

    act(() => {
      rendered.result.current.prioritizeScrollSample({
        programmatic: false,
        userInitiated: true,
      });
    });
    expect(rendered.result.current.isUserScrolling).toBe(true);

    latestValue = { revision: 2 };
    rendered.rerender();
    expect(rendered.result.current.effectiveValue.revision).toBe(1);

    act(() => {
      vi.advanceTimersByTime(TRANSCRIPT_USER_SCROLL_SETTLE_MS - 1);
    });
    expect(rendered.result.current.effectiveValue.revision).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rendered.result.current.effectiveValue.revision).toBe(2);
    expect(rendered.result.current.isUserScrolling).toBe(false);
  });

  it("extends the hold until the final user scroll sample settles", () => {
    let latestValue: Snapshot = { revision: 1 };
    const rendered = renderHook(() => useTranscriptScrollPriority({
      latestValue,
      scopeKey: "workspace:session",
    }));

    act(() => {
      rendered.result.current.prioritizeScrollSample({
        programmatic: false,
        userInitiated: true,
      });
      vi.advanceTimersByTime(TRANSCRIPT_USER_SCROLL_SETTLE_MS - 10);
      rendered.result.current.prioritizeScrollSample({ programmatic: false });
    });
    latestValue = { revision: 2 };
    rendered.rerender();

    act(() => {
      vi.advanceTimersByTime(TRANSCRIPT_USER_SCROLL_SETTLE_MS - 1);
    });
    expect(rendered.result.current.effectiveValue.revision).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rendered.result.current.effectiveValue.revision).toBe(2);
  });

  it("cannot reopen a settled hold from an unclassified correction", () => {
    let latestValue: Snapshot = { revision: 1 };
    const rendered = renderHook(() => useTranscriptScrollPriority({
      latestValue,
      scopeKey: "workspace:session",
    }));

    act(() => {
      rendered.result.current.prioritizeScrollSample({
        programmatic: false,
        userInitiated: true,
      });
      vi.advanceTimersByTime(TRANSCRIPT_USER_SCROLL_SETTLE_MS);
      rendered.result.current.prioritizeScrollSample({ programmatic: false });
    });
    latestValue = { revision: 2 };
    rendered.rerender();

    expect(rendered.result.current.isUserScrolling).toBe(false);
    expect(rendered.result.current.effectiveValue.revision).toBe(2);
  });

  it("does not hold updates for programmatic, unclassified, or unknown scroll samples", () => {
    let latestValue: Snapshot = { revision: 1 };
    const rendered = renderHook(() => useTranscriptScrollPriority({
      latestValue,
      scopeKey: "workspace:session",
    }));

    act(() => {
      rendered.result.current.prioritizeScrollSample({ programmatic: true });
      rendered.result.current.prioritizeScrollSample({ programmatic: false });
      rendered.result.current.prioritizeScrollSample();
    });
    latestValue = { revision: 2 };
    rendered.rerender();

    expect(rendered.result.current.effectiveValue.revision).toBe(2);
  });

  it("cannot carry a frozen transcript across a session switch", () => {
    let latestValue: Snapshot = { revision: 1 };
    let scopeKey = "workspace:session-a";
    const rendered = renderHook(() => useTranscriptScrollPriority({
      latestValue,
      scopeKey,
    }));

    act(() => {
      rendered.result.current.prioritizeScrollSample({
        programmatic: false,
        userInitiated: true,
      });
    });

    latestValue = { revision: 2 };
    scopeKey = "workspace:session-b";
    rendered.rerender();

    expect(rendered.result.current.effectiveValue.revision).toBe(2);
  });

  it("never freezes state from an abandoned concurrent render", () => {
    const suspendedForever = new Promise<void>(() => {});
    let attemptedRevision = 0;
    let beginSuspendedUpdate = () => {};
    let claimScroll: ((sample: {
      programmatic: boolean;
      userInitiated?: true;
    }) => void) | null = null;

    function Harness() {
      const [revision, setRevision] = useState(1);
      const priority = useTranscriptScrollPriority({
        latestValue: { revision },
        scopeKey: "workspace:session",
      });
      attemptedRevision = revision;
      beginSuspendedUpdate = () => {
        startTransition(() => setRevision(2));
      };
      claimScroll = priority.prioritizeScrollSample;
      if (revision === 2) {
        throw suspendedForever;
      }
      return <div data-testid="revision">{priority.effectiveValue.revision}</div>;
    }

    const rendered = render(
      <Suspense fallback={<div>loading</div>}>
        <Harness />
      </Suspense>,
    );
    expect(rendered.getByTestId("revision").textContent).toBe("1");

    act(() => beginSuspendedUpdate());
    expect(attemptedRevision).toBe(2);
    expect(rendered.getByTestId("revision").textContent).toBe("1");

    act(() => {
      claimScroll?.({ programmatic: false, userInitiated: true });
    });
    expect(rendered.getByTestId("revision").textContent).toBe("1");
  });
});
