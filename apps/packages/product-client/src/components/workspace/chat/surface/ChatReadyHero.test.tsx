// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_PRE_MESSAGE_LABELS } from "#product/copy/chat/chat-copy";
import { ChatReadyHero } from "./ChatReadyHero";

afterEach(cleanup);

describe("ChatReadyHero", () => {
  it("renders the ready title at the pane-level title role, not the display hero role", () => {
    render(<ChatReadyHero />);

    const title = screen.getByRole("heading", {
      name: CHAT_PRE_MESSAGE_LABELS.readyTitle,
    });
    expect(title.className).toContain("text-title");
    expect(title.className).not.toContain("text-hero");
  });

  it("keeps the title centered without vestigial top offset", () => {
    render(<ChatReadyHero />);

    const title = screen.getByRole("heading", {
      name: CHAT_PRE_MESSAGE_LABELS.readyTitle,
    });
    expect(title.className).not.toContain("mt-");
  });

  it("carries no tracking override on top of the title role", () => {
    render(<ChatReadyHero />);

    const title = screen.getByRole("heading", {
      name: CHAT_PRE_MESSAGE_LABELS.readyTitle,
    });
    expect(title.className).not.toContain("tracking-");
  });
});
