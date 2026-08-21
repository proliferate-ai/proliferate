// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderInput,
} from "./MarkdownBody";

afterEach(() => {
  cleanup();
});

describe("MarkdownBody code renderer identity", () => {
  it("does not replace the code component type across ordinary streaming updates", () => {
    let mounts = 0;
    function Probe({ children }: { children: ReactNode }) {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <span data-code-probe="true">{children}</span>;
    }
    function renderCodeBlock({ code }: MarkdownCodeBlockRenderInput) {
      return <Probe>{code}</Probe>;
    }

    const closedFence = "```ts\nconst ready = true;\n```";
    const { rerender } = render(
      <MarkdownBody
        content={closedFence}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(mounts).toBe(1);

    rerender(
      <MarkdownBody
        content={`${closedFence}\n\nHere is what this means`}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(mounts).toBe(1);
  });
});
