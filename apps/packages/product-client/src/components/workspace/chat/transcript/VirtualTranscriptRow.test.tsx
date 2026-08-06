/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { MemoizedVirtualTranscriptRow } from "./VirtualTranscriptRow";

const ROW: TranscriptVirtualRow = {
  kind: "pending_prompt",
  key: "pending-prompt:session-1",
};

afterEach(cleanup);

describe("MemoizedVirtualTranscriptRow", () => {
  it("keeps an unchanged row mounted across renderer identity churn", () => {
    const firstRenderer = vi.fn(() => <div>first</div>);
    const nextRenderer = vi.fn(() => <div>next</div>);
    const measureElement = vi.fn();
    const stableRevision = {};
    const rendered = render(
      <MemoizedVirtualTranscriptRow
        row={ROW}
        rowIndex={0}
        virtualIndex={0}
        renderRow={firstRenderer}
        renderRevision={stableRevision}
        measureElement={measureElement}
      />,
    );

    rendered.rerender(
      <MemoizedVirtualTranscriptRow
        row={ROW}
        rowIndex={0}
        virtualIndex={0}
        renderRow={nextRenderer}
        renderRevision={stableRevision}
        measureElement={measureElement}
      />,
    );

    expect(firstRenderer).toHaveBeenCalledTimes(1);
    expect(nextRenderer).not.toHaveBeenCalled();
    expect(rendered.getByText("first")).toBeTruthy();

    rendered.rerender(
      <MemoizedVirtualTranscriptRow
        row={ROW}
        rowIndex={0}
        virtualIndex={0}
        renderRow={nextRenderer}
        renderRevision={{}}
        measureElement={measureElement}
      />,
    );

    expect(nextRenderer).toHaveBeenCalledTimes(1);
    expect(rendered.getByText("next")).toBeTruthy();
  });
});
