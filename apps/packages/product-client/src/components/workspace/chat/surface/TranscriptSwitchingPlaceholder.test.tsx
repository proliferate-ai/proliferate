// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";
import { TranscriptSwitchingPlaceholder } from "./TranscriptSwitchingPlaceholder";

afterEach(cleanup);

describe("TranscriptSwitchingPlaceholder", () => {
  it("uses the same column and gutter order as transcript and composer states", () => {
    render(<TranscriptSwitchingPlaceholder />);

    const gutter = screen.getByRole("status", { name: "Loading chat" });
    expect(gutter.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
    expect(gutter.firstElementChild?.className).toContain(CHAT_COLUMN_CLASSNAME);
  });

  it("shows a delayed clean loader instead of message skeletons (PRO-182)", () => {
    render(<TranscriptSwitchingPlaceholder label="Switching chat" />);

    const gutter = screen.getByRole("status", { name: "Switching chat" });
    expect(gutter.querySelector("[data-dot-cell-loader]")).not.toBeNull();
    // The delayed fade keeps fast switches from flashing the loader.
    expect(gutter.firstElementChild?.className).toContain("animate-content-fade-in");
    expect(gutter.textContent).toContain("Switching chat");
  });
});
