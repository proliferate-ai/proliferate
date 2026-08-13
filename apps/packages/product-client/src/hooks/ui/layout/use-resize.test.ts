/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResize } from "#product/hooks/ui/layout/use-resize";

afterEach(() => {
  cleanup();
});

function overlayDivs(): HTMLElement[] {
  return Array.from(document.body.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.style.cursor === "col-resize",
  );
}

function mouseDownEvent(clientX: number) {
  return {
    clientX,
    clientY: 0,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.MouseEvent;
}

describe("useResize", () => {
  it("resizes across a mousedown/mousemove/mouseup drag and stops responding after mouseup", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(230);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    onResize.mockClear();

    // The drag ended: further document-level mousemoves are stray input from
    // whatever the user does next, not a continuation of this gesture.
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 90 }));
    });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("seeds the gesture from resolveSize at mousedown when the rendered size diverges", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() =>
      useResize({
        direction: "horizontal",
        size: 700,
        resolveSize: () => 400,
        onResize,
      }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30 }));
    });
    // From the rendered 400, not the tracked 700: the first pixel of pointer
    // travel moves the panel instead of replaying the divergence as dead zone.
    expect(onResize).toHaveBeenLastCalledWith(430);
  });

  it("appends exactly one cursor-overlay div for the duration of the drag, and removes it on mouseup", () => {
    const { result } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize: vi.fn() }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    expect(overlayDivs()).toHaveLength(1);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(overlayDivs()).toHaveLength(0);
  });

  /**
   * The regression this guards: the owning component (a workspace shell, a
   * panel) can unmount mid-drag — a workspace switch, an error boundary, a
   * session teardown — with no `mouseup` ever firing for that gesture. Before
   * the unmount-time cleanup, that left the `mousemove`/`mouseup` listeners on
   * `document` and the fixed `inset:0` cursor-overlay div in `document.body`
   * permanently: the overlay visually blocks every future pointer interaction
   * on the page until reload, and the listeners keep calling a stale
   * `onResize` closure over dead state.
   */
  it("removes the listeners and the cursor overlay if the owner unmounts mid-drag", () => {
    const onResize = vi.fn();
    const { result, unmount } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    expect(overlayDivs()).toHaveLength(1);

    unmount();

    expect(overlayDivs()).toHaveLength(0);

    onResize.mockClear();
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 999 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does nothing on unmount when no drag is in flight", () => {
    const { unmount } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize: vi.fn() }));

    expect(() => unmount()).not.toThrow();
    expect(overlayDivs()).toHaveLength(0);
  });

  it("fires onResizeEnd exactly once, at mouseup, and never for stray mouseups after it", () => {
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize: vi.fn(), onResizeEnd }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30 }));
    });
    expect(onResizeEnd).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("fires onResizeEnd when the owner unmounts mid-drag, so the gesture's outcome is not lost", () => {
    const onResizeEnd = vi.fn();
    const { result, unmount } = renderHook(() =>
      useResize({ direction: "horizontal", size: 200, onResize: vi.fn(), onResizeEnd }));

    act(() => {
      result.current(mouseDownEvent(0));
    });
    unmount();

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });
});
