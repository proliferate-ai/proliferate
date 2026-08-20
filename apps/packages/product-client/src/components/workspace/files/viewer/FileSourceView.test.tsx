/* @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSourceView } from "#product/components/workspace/files/viewer/FileSourceView";

const scrollToIndexMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const instance = actual.useVirtualizer(options);
      instance.scrollToIndex = scrollToIndexMock;
      return instance;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function codeWithLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

describe("FileSourceView location jump (03D)", () => {
  it("centers the clamped line via virtualizer.scrollToIndex on the virtualized path", () => {
    const code = codeWithLines(3000);
    const onConsumed = vi.fn();

    render(
      <FileSourceView
        code={code}
        filePath="big.ts"
        wordWrap={false}
        locationRequestToken={1}
        locationRequestLine={2500}
        onLocationRequestConsumed={onConsumed}
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(2499, { align: "center" });
    expect(onConsumed).toHaveBeenCalledWith(1);
  });

  it("clamps an out-of-range line to the last row on the virtualized path", () => {
    const code = codeWithLines(3000);

    render(
      <FileSourceView
        code={code}
        filePath="big.ts"
        wordWrap={false}
        locationRequestToken={1}
        locationRequestLine={999999}
        onLocationRequestConsumed={vi.fn()}
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(2999, { align: "center" });
  });

  it("queries the [data-source-line] row and calls scrollIntoView on the non-virtualized path", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    try {
      const code = codeWithLines(50);
      const onConsumed = vi.fn();

      const { container } = render(
        <FileSourceView
          code={code}
          filePath="small.ts"
          wordWrap={false}
          locationRequestToken={7}
          locationRequestLine={12}
          onLocationRequestConsumed={onConsumed}
        />,
      );

      const row = container.querySelector('[data-source-line][data-line="12"]');
      expect(row).not.toBeNull();
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "center" });
      expect(scrollIntoViewMock.mock.instances[0]).toBe(row);
      expect(onConsumed).toHaveBeenCalledWith(7);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("clamps an out-of-range line to the last displayed row on the non-virtualized path", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    try {
      const code = codeWithLines(10);

      const { container } = render(
        <FileSourceView
          code={code}
          filePath="small.ts"
          wordWrap={false}
          locationRequestToken={1}
          locationRequestLine={999}
          onLocationRequestConsumed={vi.fn()}
        />,
      );

      const row = container.querySelector('[data-source-line][data-line="10"]');
      expect(row).not.toBeNull();
      expect(scrollIntoViewMock.mock.instances[0]).toBe(row);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("does not jump when no location request is pending", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    try {
      render(
        <FileSourceView
          code={codeWithLines(10)}
          filePath="small.ts"
          wordWrap={false}
        />,
      );

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("consumes a request exactly once and a re-render with the same token does not re-jump", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    try {
      const onConsumed = vi.fn();
      const { rerender } = render(
        <FileSourceView
          code={codeWithLines(10)}
          filePath="small.ts"
          wordWrap={false}
          locationRequestToken={3}
          locationRequestLine={5}
          onLocationRequestConsumed={onConsumed}
        />,
      );
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(onConsumed).toHaveBeenCalledTimes(1);

      // A store-level consume nulls the request (token stays the same prop
      // value only until the parent re-renders); simulate a re-render that
      // still carries the same not-yet-invalidated token (e.g. an unrelated
      // prop change) and confirm it is inert.
      rerender(
        <FileSourceView
          code={codeWithLines(10)}
          filePath="small.ts"
          wordWrap
          locationRequestToken={3}
          locationRequestLine={5}
          onLocationRequestConsumed={onConsumed}
        />,
      );

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(onConsumed).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("a new token re-centers even onto the identical line (repeat activation)", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    try {
      const onConsumed = vi.fn();
      const { rerender } = render(
        <FileSourceView
          code={codeWithLines(10)}
          filePath="small.ts"
          wordWrap={false}
          locationRequestToken={1}
          locationRequestLine={5}
          onLocationRequestConsumed={onConsumed}
        />,
      );
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      act(() => {
        rerender(
          <FileSourceView
            code={codeWithLines(10)}
            filePath="small.ts"
            wordWrap={false}
            locationRequestToken={2}
            locationRequestLine={5}
            onLocationRequestConsumed={onConsumed}
          />,
        );
      });

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
      expect(onConsumed).toHaveBeenLastCalledWith(2);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
