// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@proliferate/product-ui/chat/ChatColumn";
import { TranscriptSwitchingPlaceholder } from "./TranscriptSwitchingPlaceholder";

afterEach(cleanup);

describe("TranscriptSwitchingPlaceholder", () => {
  it("uses the same column and gutter order as transcript and composer states", () => {
    render(<TranscriptSwitchingPlaceholder />);

    const gutter = screen.getByRole("status", { name: "Loading chat" });
    expect(gutter.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
    expect(gutter.firstElementChild?.className).toContain(CHAT_COLUMN_CLASSNAME);
  });
});
