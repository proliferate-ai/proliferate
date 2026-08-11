/* @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { useWorkspaceShellGeometry } from "#product/hooks/workspaces/ui/use-workspace-shell-geometry";

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

function GeometryHarness({
  leftWidth,
  rightWidth,
  snapLeft = false,
  snapRight = false,
  onToggleLeft = () => {},
}: {
  leftWidth: number;
  rightWidth: number;
  snapLeft?: boolean;
  snapRight?: boolean;
  onToggleLeft?: () => void;
}) {
  const geometry = useWorkspaceShellGeometry({
    leftWidth,
    rightWidth,
    snapLeft,
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

  it("applies pointer-driven left widths immediately without a release tween on manual renderers", () => {
    vi.stubGlobal("CSS", {});
    stubReducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={275} rightWidth={360} />,
    );

    // A live left drag lands on the cursor-provided width and schedules no
    // interpolation work for that edge.
    rerender(
      <GeometryHarness leftWidth={375} rightWidth={360} snapLeft />,
    );
    const root = getByTestId("geometry");
    expect(root.dataset.snap).toBe("true");
    expect(frames).toHaveLength(0);
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("375px");

    // Releasing at the same target removes the snap contract without adding
    // a 240ms tail animation after the pointer has stopped.
    rerender(<GeometryHarness leftWidth={375} rightWidth={360} />);
    expect(root.dataset.snap).toBe("false");
    expect(frames).toHaveLength(0);
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("375px");
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
