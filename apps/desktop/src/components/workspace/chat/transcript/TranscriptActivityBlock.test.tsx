// @vitest-environment jsdom

import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import { thoughtItem } from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptActivityBlock } from "./TranscriptActivityBlock";
import { TranscriptEntryMotionProvider } from "./TranscriptEntryMotionContext";

afterEach(cleanup);

describe("TranscriptActivityBlock entry motion", () => {
  it("animates a newly streamed activity once without replaying on remount", () => {
    let transcript = transcriptWithItems(["existing"]);
    const { container, rerender } = render(
      <StrictMode>
        <MotionFixture transcript={transcript} entryItemId="existing" />
      </StrictMode>,
    );
    expect(container.querySelector("[data-transcript-activity-entry='true']")).toBeNull();

    transcript = transcriptWithItems(["existing", "new-tool"]);
    rerender(
      <StrictMode>
        <MotionFixture transcript={transcript} entryItemId="new-tool" />
      </StrictMode>,
    );
    const animatedNode = container.querySelector("[data-transcript-activity-entry='true']");
    expect(animatedNode?.className).toContain("animate-transcript-activity-in");

    rerender(
      <StrictMode>
        <MotionFixture transcript={transcript} entryItemId="new-tool" />
      </StrictMode>,
    );
    expect(container.querySelector("[data-transcript-activity-block]")).toBe(animatedNode);

    rerender(
      <StrictMode>
        <MotionFixture
          transcript={transcript}
          entryItemId="new-tool"
          showActivity={false}
        />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <MotionFixture transcript={transcript} entryItemId="new-tool" />
      </StrictMode>,
    );
    expect(container.querySelector("[data-transcript-activity-entry='true']")).toBeNull();
  });

  it("uses a short compositor-only left-to-right settle with reduced-motion fallback", () => {
    const cssPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../../packages/design/src/css/desktop.css",
    );
    const css = readFileSync(cssPath, "utf8");
    const start = css.indexOf("@keyframes transcript-activity-in");
    const end = css.indexOf("/* ---- Sidebar update pill ---- */", start);
    const section = css.slice(start, end);

    expect(section).toContain("opacity: 0");
    expect(section).toContain("transform: translateX(-4px)");
    expect(section).toContain("150ms cubic-bezier(0.19, 1, 0.22, 1)");
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");
    expect(section).not.toContain("height:");
    expect(section).not.toContain("margin:");
    expect(section).not.toContain("scale(");
  });
});

function MotionFixture({
  transcript,
  entryItemId,
  showActivity = true,
}: {
  transcript: TranscriptState;
  entryItemId: string;
  showActivity?: boolean;
}) {
  return (
    <TranscriptEntryMotionProvider transcript={transcript}>
      {showActivity ? (
        <TranscriptActivityBlock
          key={entryItemId}
          entryItemId={entryItemId}
          animateEntry
        >
          {entryItemId}
        </TranscriptActivityBlock>
      ) : (
        <div>temporarily virtualized</div>
      )}
    </TranscriptEntryMotionProvider>
  );
}

function transcriptWithItems(itemIds: string[]): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.itemsById = Object.fromEntries(itemIds.map((itemId, index) => [
    itemId,
    thoughtItem(itemId, "turn-1", index + 1, false),
  ]));
  return transcript;
}
