// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CloudChatUserMessage } from "./CloudChatUserMessage";

afterEach(() => {
  cleanup();
});

describe("CloudChatUserMessage", () => {
  it("shares the transcript bubble geometry and keyboard action reveal", () => {
    const { container } = render(<CloudChatUserMessage content="A normal prompt" />);

    const bubble = container.querySelector<HTMLElement>(".chat-user-message-bubble");
    expect(bubble?.tabIndex).toBe(0);
    expect(bubble?.className).toContain("focus-visible:ring-2");
    expect((bubble?.firstElementChild as HTMLElement | null)?.style.maxHeight).toBe("19lh");
    expect(container.innerHTML).toContain("group-focus-within/msg:opacity-100");
  });

  it("renders compact markdown lists in user prompts", () => {
    const { container } = render(
      <CloudChatUserMessage content={"A list:\n\n- First\n- Second"} />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("ul")?.parentElement?.className)
      .toContain("[&_li+li]:!mt-0");
  });
});
