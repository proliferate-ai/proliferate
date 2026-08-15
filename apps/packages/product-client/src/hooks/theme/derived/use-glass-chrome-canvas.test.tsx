/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGlassChromeCanvas } from "#product/hooks/theme/derived/use-glass-chrome-canvas";

describe("useGlassChromeCanvas", () => {
  afterEach(() => {
    document.documentElement.style.backgroundColor = "";
  });

  it("makes the canvas transparent while active and restores it after", () => {
    document.documentElement.style.backgroundColor = "rgb(20, 20, 20)";

    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useGlassChromeCanvas(active),
      { initialProps: { active: true } },
    );
    expect(document.documentElement.style.backgroundColor).toBe("transparent");

    rerender({ active: false });
    expect(document.documentElement.style.backgroundColor).toBe("rgb(20, 20, 20)");

    rerender({ active: true });
    expect(document.documentElement.style.backgroundColor).toBe("transparent");

    unmount();
    expect(document.documentElement.style.backgroundColor).toBe("rgb(20, 20, 20)");
  });

  it("leaves the canvas untouched while inactive", () => {
    document.documentElement.style.backgroundColor = "rgb(20, 20, 20)";

    const { unmount } = renderHook(() => useGlassChromeCanvas(false));
    expect(document.documentElement.style.backgroundColor).toBe("rgb(20, 20, 20)");

    unmount();
    expect(document.documentElement.style.backgroundColor).toBe("rgb(20, 20, 20)");
  });
});
