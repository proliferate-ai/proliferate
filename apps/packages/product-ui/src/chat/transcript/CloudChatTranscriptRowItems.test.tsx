/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudChatTranscriptRowView } from "./CloudChatTranscriptTypes";
import {
  CloudChatThoughtRow,
  CloudChatWorkHistoryRow,
} from "./CloudChatTranscriptRowItems";

afterEach(cleanup);

describe("Cloud chat transcript optical spacing", () => {
  it("uses the compact reasoning icon-to-label gap", () => {
    const { container } = render(
      <CloudChatThoughtRow
        row={{ id: "thought-1", kind: "thought", title: "Thought", status: "completed" }}
      />,
    );

    const actionRow = container.querySelector("[data-cloud-transcript-action-row]");
    expect(actionRow?.className.split(" ")).toContain("gap-1");
    expect(actionRow?.className.split(" ")).not.toContain("gap-1.5");
  });

  it("keeps the collapsed divider, then uses the normal item gap without a divider when expanded", () => {
    const child: CloudChatTranscriptRowView = {
      id: "tool-1",
      kind: "tool",
      title: "Read files",
      status: "completed",
    };
    const { container } = render(
      <CloudChatWorkHistoryRow
        row={{
          id: "history-1",
          kind: "work_history",
          title: "Worked for 12s",
          children: [child],
        }}
        renderChildRow={(row) => <span data-child-row={row.id}>{row.title}</span>}
      />,
    );

    expect(container.querySelector("[data-cloud-work-history-divider]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Worked for 12s" }));

    const items = container.querySelector("[data-cloud-work-history-items]");
    expect(items?.className.split(" ")).toContain("mt-4");
    expect(items?.className.split(" ")).toContain("space-y-4");
    expect(container.querySelector("[data-cloud-work-history-divider]")).toBeNull();
    expect(screen.queryByText("Read files")).not.toBeNull();
  });
});
