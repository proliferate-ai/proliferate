/* @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { useWorkspaceShellGeometry } from "#product/hooks/workspaces/ui/use-workspace-shell-geometry";
import type { WorkspaceShellResizeEdge } from "#product/lib/domain/workspaces/shell/workspace-shell-sizing";

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function stubResizeObserver(): (width: number) => void {
  let resize: ((width: number) => void) | null = null;
  vi.stubGlobal("ResizeObserver", class {
    private target: Element | null = null;

    constructor(callback: ResizeObserverCallback) {
      resize = (width) => callback([{
        target: this.target,
        contentRect: { width },
      } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }

    observe(target: Element) {
      this.target = target;
    }

    disconnect() {}
  });
  return (width) => {
    if (!resize) {
      throw new Error("ResizeObserver has not observed the geometry root");
    }
    resize(width);
  };
}

function GeometryHarness({
  leftWidth,
  rightWidth,
  activeResizeEdge = null,
  snapRight = false,
  onToggleLeft = () => {},
}: {
  leftWidth: number;
  rightWidth: number;
  activeResizeEdge?: WorkspaceShellResizeEdge | null;
  snapRight?: boolean;
  onToggleLeft?: () => void;
}) {
  const geometry = useWorkspaceShellGeometry({
    leftWidth,
    rightWidth,
    activeResizeEdge,
    snapRight,
    onToggleLeft,
  });
  return (
    <>
      <div
        ref={geometry.rootRef}
        style={geometry.style}
        data-testid="geometry"
        data-manual={geometry.usesManualInterpolation ? "true" : "false"}
        data-snap={geometry.snapLeft ? "true" : "false"}
        data-snap-viewport={geometry.snapViewport ? "true" : "false"}
      />
      <button type="button" onClick={() => geometry.toggleLeft({ snapGeometry: true })}>
        Pin
      </button>
      <button type="button" onClick={() => geometry.toggleLeft()}>
        Toggle
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useWorkspaceShellGeometry", () => {
  it("reserves a usable main pane when both requested rails exceed the viewport budget", () => {
    vi.stubGlobal("CSS", { registerProperty: vi.fn() });
    stubReducedMotion(false);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1083,
    } as DOMRect);

    const { getByTestId } = render(
      <GeometryHarness leftWidth={420} rightWidth={480} />,
    );

    const root = getByTestId("geometry");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("283px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("380px");
  });

  it("tracks container pressure, snaps each viewport clamp, and restores requested widths", () => {
    vi.stubGlobal("CSS", { registerProperty: vi.fn() });
    stubReducedMotion(false);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1083,
    } as DOMRect);
    const resize = stubResizeObserver();

    const { getByTestId } = render(
      <GeometryHarness leftWidth={420} rightWidth={480} />,
    );
    const root = getByTestId("geometry");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("283px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("380px");

    act(() => resize(1024));
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("224px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("380px");
    expect(root.dataset.snapViewport).toBe("true");

    act(() => resize(1320));
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("420px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("480px");
  });

  it("gives the actively dragged edge precedence without a hidden-width dead zone", () => {
    vi.stubGlobal("CSS", { registerProperty: vi.fn() });
    stubReducedMotion(false);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1083,
    } as DOMRect);
    const resize = stubResizeObserver();
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={420} rightWidth={480} />,
    );

    rerender(
      <GeometryHarness
        leftWidth={420}
        rightWidth={400}
        activeResizeEdge="right"
        snapRight
      />,
    );

    const root = getByTestId("geometry");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("263px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("400px");

    rerender(<GeometryHarness leftWidth={420} rightWidth={400} />);
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("263px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("400px");

    act(() => resize(1320));
    act(() => resize(1083));
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("283px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("380px");
  });

  it("leaves interpolation to CSS when registered properties are supported", () => {
    vi.stubGlobal("CSS", { registerProperty: vi.fn() });
    stubReducedMotion(false);
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} />,
    );

    rerender(<GeometryHarness leftWidth={280} rightWidth={360} />);
    const root = getByTestId("geometry");
    expect(root.dataset.manual).toBe("false");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("360px");
  });

  it("drives unsupported renderers with one time-based rAF loop", () => {
    vi.stubGlobal("CSS", {});
    stubReducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} />,
    );

    rerender(<GeometryHarness leftWidth={280} rightWidth={360} />);
    const root = getByTestId("geometry");
    expect(root.dataset.manual).toBe("true");
    expect(frames).toHaveLength(1);

    act(() => frames.shift()?.(0));
    act(() => frames.shift()?.(motion.duration.panelMs));
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("360px");
  });

  it("snaps unsupported renderers when reduced motion is active", () => {
    vi.stubGlobal("CSS", {});
    stubReducedMotion(true);
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} />,
    );

    rerender(<GeometryHarness leftWidth={280} rightWidth={360} />);
    const root = getByTestId("geometry");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("360px");
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("applies pointer-driven right widths immediately on manual renderers", () => {
    vi.stubGlobal("CSS", {});
    stubReducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={0} rightWidth={360} />,
    );

    // A drag move with only the right width changing never schedules a tween.
    rerender(<GeometryHarness leftWidth={0} rightWidth={480} snapRight />);
    const root = getByTestId("geometry");
    expect(frames).toHaveLength(0);
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("480px");

    // A simultaneous left change still eases while the right lands directly.
    rerender(<GeometryHarness leftWidth={280} rightWidth={500} snapRight />);
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("500px");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("0px");

    act(() => frames.shift()?.(0));
    act(() => frames.shift()?.(motion.duration.panelMs));
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("500px");
  });

  it("clears a pending pin snap before a rapid ordinary toggle", () => {
    vi.stubGlobal("CSS", { registerProperty: vi.fn() });
    stubReducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onToggleLeft = vi.fn();
    const { getByRole, getByTestId } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} onToggleLeft={onToggleLeft} />,
    );

    act(() => getByRole("button", { name: "Pin" }).click());
    expect(getByTestId("geometry").dataset.snap).toBe("true");

    act(() => getByRole("button", { name: "Toggle" }).click());
    expect(getByTestId("geometry").dataset.snap).toBe("false");
    expect(cancelFrame).toHaveBeenCalled();
    expect(onToggleLeft).toHaveBeenCalledTimes(2);
  });
});
