import { describe, expect, it } from "vitest";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  HOME_CHAT_COMPOSER_INPUT,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { computeComposerTextareaAutosize } from "./composer-textarea-sizing";

describe("computeComposerTextareaAutosize", () => {
  it("clamps short content to the configured minimum height", () => {
    expect(computeComposerTextareaAutosize({
      scrollHeightPx: 12,
      lineHeightPx: 20,
      rootFontSizePx: 16,
      lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
      minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
      maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
      minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
    })).toEqual({
      heightPx: 44,
      overflowY: "hidden",
    });
  });

  it("caps workspace composer content at 16 rows", () => {
    expect(computeComposerTextareaAutosize({
      scrollHeightPx: 400,
      lineHeightPx: 20,
      rootFontSizePx: 16,
      lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
      minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
      maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
      minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
    })).toEqual({
      heightPx: 320,
      overflowY: "auto",
    });
  });

  it("keeps the home composer cap at 8 rows", () => {
    expect(computeComposerTextareaAutosize({
      scrollHeightPx: 400,
      lineHeightPx: 20,
      rootFontSizePx: 16,
      lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
      minRows: HOME_CHAT_COMPOSER_INPUT.minRows,
      maxRows: HOME_CHAT_COMPOSER_INPUT.maxRows,
      minHeightRem: HOME_CHAT_COMPOSER_INPUT.minHeightRem,
    })).toEqual({
      heightPx: 160,
      overflowY: "auto",
    });
  });

  it("does not scroll at the max-height threshold", () => {
    expect(computeComposerTextareaAutosize({
      scrollHeightPx: 320,
      lineHeightPx: 20,
      rootFontSizePx: 16,
      lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
      minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
      maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
      minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
    })).toEqual({
      heightPx: 320,
      overflowY: "hidden",
    });
  });

  it("falls back when computed font sizes are invalid", () => {
    expect(computeComposerTextareaAutosize({
      scrollHeightPx: 80,
      lineHeightPx: Number.NaN,
      rootFontSizePx: Number.NaN,
      lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
      minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
      maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
      minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
    })).toEqual({
      heightPx: 80,
      overflowY: "hidden",
    });
  });
});
