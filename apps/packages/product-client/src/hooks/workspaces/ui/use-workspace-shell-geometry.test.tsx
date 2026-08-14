/* @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShellGeometry } from "#product/hooks/workspaces/ui/use-workspace-shell-geometry";

function GeometryHarness({
  leftWidth,
  rightWidth,
  snapLeft = false,
  onToggleLeft = () => {},
}: {
  leftWidth: number;
  rightWidth: number;
  snapLeft?: boolean;
  onToggleLeft?: () => void;
}) {
  const geometry = useWorkspaceShellGeometry({
    leftWidth,
    rightWidth,
    snapLeft,
    onToggleLeft,
  });
  return (
    <>
      <div
        style={geometry.style}
        data-testid="geometry"
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
  it("publishes pane widths as unregistered geometry vars", () => {
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} />,
    );

    rerender(<GeometryHarness leftWidth={280} rightWidth={360} />);
    const root = getByTestId("geometry");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--workspace-right-width")).toBe("360px");
  });

  it("reports a live left drag through the snap contract", () => {
    const { getByTestId, rerender } = render(
      <GeometryHarness leftWidth={275} rightWidth={360} />,
    );

    rerender(<GeometryHarness leftWidth={375} rightWidth={360} snapLeft />);
    const root = getByTestId("geometry");
    expect(root.dataset.snap).toBe("true");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("375px");

    // Releasing at the same target removes the snap contract while the
    // published geometry stays on the cursor-provided width.
    rerender(<GeometryHarness leftWidth={375} rightWidth={360} />);
    expect(root.dataset.snap).toBe("false");
    expect(root.style.getPropertyValue("--workspace-left-width")).toBe("375px");
  });

  it("clears a pending pin snap before a rapid ordinary toggle", () => {
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

  it("releases a pin snap after the double-frame handoff", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByRole, getByTestId } = render(
      <GeometryHarness leftWidth={0} rightWidth={0} />,
    );

    act(() => getByRole("button", { name: "Pin" }).click());
    expect(getByTestId("geometry").dataset.snap).toBe("true");

    act(() => frames.shift()?.(0));
    act(() => frames.shift()?.(16));
    expect(getByTestId("geometry").dataset.snap).toBe("false");
  });
});
