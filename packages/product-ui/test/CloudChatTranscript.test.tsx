// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CloudChatTranscript } from "../src/chat/CloudChatTranscript";

describe("CloudChatTranscript", () => {
  afterEach(cleanup);

  it("renders non-message rows with collapsible desktop-style transcript treatment", () => {
    render(
      <CloudChatTranscript
        emptyTitle="No transcript"
        rows={[
          {
            id: "thought",
            kind: "thought",
            title: "Thinking",
            body: "Inspecting the workspace\nChecking command output",
          },
          {
            id: "tool",
            kind: "tool",
            title: "Read file",
            detail: "src/app.ts",
            status: "completed",
            body: "```text\nfile contents\n```",
          },
          {
            id: "group",
            kind: "tool_group",
            title: "Worked for 10s",
            body: "Ran checks and summarized the result.",
          },
          {
            id: "system",
            kind: "system",
            body: "System instruction body",
          },
          {
            id: "error",
            kind: "error",
            title: "Session failed",
            detail: "Provider returned an error",
            body: "Provider returned an error\ntraceback detail",
            status: "failed",
          },
        ]}
      />,
    );

    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.queryByText("Checking command output")).toBeNull();
    fireEvent.click(screen.getByText("Thinking"));
    expect(screen.getAllByText((_, element) =>
      element?.textContent === "Inspecting the workspace\nChecking command output"
    ).length).toBeGreaterThan(0);

    expect(screen.getByText("Read file")).toBeTruthy();
    expect(screen.queryByText("file contents")).toBeNull();
    fireEvent.click(screen.getByText("Read file"));
    expect(screen.getByText("file contents")).toBeTruthy();

    expect(screen.getByText("Worked for 10s")).toBeTruthy();
    expect(screen.queryByText("Ran checks and summarized the result.")).toBeNull();
    fireEvent.click(screen.getByText("Worked for 10s"));
    expect(screen.getByText("Ran checks and summarized the result.")).toBeTruthy();

    expect(screen.getByText("System message")).toBeTruthy();
    expect(screen.queryByText("System instruction body")).toBeNull();
    fireEvent.click(screen.getByText("System message"));
    expect(screen.getByText("System instruction body")).toBeTruthy();

    expect(screen.getByText("Session failed")).toBeTruthy();
    expect(screen.getByText("Provider returned an error")).toBeTruthy();
    expect(screen.queryByText("traceback detail")).toBeNull();
    fireEvent.click(screen.getByText("Details"));
    expect(screen.getByText(/traceback detail/)).toBeTruthy();
  });
});
