// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

describe("MarkdownBody transcript styling", () => {
  afterEach(cleanup);

  it("matches the transcript prose hierarchy and block geometry", () => {
    const { container } = render(
      <MarkdownBody
        styleVariant="transcript"
        content={[
          "#### Heading four",
          "##### Heading five",
          "###### Heading six",
          "",
          "> Quoted text",
          "",
          "---",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("h4")?.classList.contains("text-[17px]")).toBe(true);
    for (const heading of container.querySelectorAll("h5, h6")) {
      expect(heading.classList.contains("text-[15px]")).toBe(true);
      expect(heading.classList.contains("uppercase")).toBe(false);
      expect(heading.classList.contains("text-muted-foreground")).toBe(false);
    }

    const quote = container.querySelector("blockquote");
    expect(quote?.classList.contains("pl-6")).toBe(true);
    expect(quote?.classList.contains("py-2")).toBe(true);
    expect(quote?.classList.contains("before:w-1")).toBe(true);
    expect(quote?.classList.contains("not-italic")).toBe(true);

    const rule = container.querySelector("hr");
    expect(rule?.classList.contains("my-7")).toBe(true);
    expect(rule?.classList.contains("border-foreground/15")).toBe(true);
    expect(rule?.classList.contains("[&+*]:mt-0")).toBe(true);
  });

  it("renders an unframed edge-bleed table with reference cell spacing", () => {
    const { container } = render(
      <MarkdownBody
        content={"| Name | Value |\n| --- | --- |\n| One | Two |"}
        styleVariant="transcript"
      />,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-wide-markdown-block-kind='table']");
    expect(wrapper?.classList.contains("-mx-4")).toBe(true);
    expect(wrapper?.classList.contains("px-4")).toBe(true);
    expect(wrapper?.classList.contains("sm:-mx-6")).toBe(true);
    expect(wrapper?.classList.contains("sm:px-6")).toBe(true);
    expect(wrapper?.classList.contains("overflow-x-auto")).toBe(true);
    expect(wrapper?.classList.contains("rounded-lg")).toBe(false);
    expect(wrapper?.classList.contains("border")).toBe(false);

    const table = wrapper?.querySelector("table");
    expect(table?.classList.contains("border-separate")).toBe(true);
    expect(table?.className).not.toContain("nth-child(2n)");
    expect(table?.querySelector("th")?.classList.contains("bg-foreground/5")).toBe(false);
    expect(table?.querySelector("th")?.classList.contains("leading-4")).toBe(true);
    expect(table?.querySelector("td")?.classList.contains("py-2.5")).toBe(true);
  });

  it("uses the dedicated transcript code scale for inline and fenced code", () => {
    const { container } = render(
      <MarkdownBody
        content={"Use `value` here.\n\n```ts\nconst value = 1;\n```"}
        styleVariant="transcript"
      />,
    );

    const codeSize = "text-[length:var(--text-chat-code,var(--text-chat))]";
    const codeLeading =
      "leading-[var(--text-chat-code--line-height,1.5)]";
    const inlineCode = container.querySelector("p code");
    const fencedCode = container.querySelector("pre code");

    expect(inlineCode?.classList.contains(codeSize)).toBe(true);
    expect(inlineCode?.classList.contains(codeLeading)).toBe(false);
    expect(inlineCode?.classList.contains("rounded-md")).toBe(true);
    expect(fencedCode?.classList.contains(codeSize)).toBe(true);
    expect(fencedCode?.classList.contains(codeLeading)).toBe(true);
  });

  it("keeps document markdown on the legacy framed presentation", () => {
    const { container } = render(
      <MarkdownBody content={"##### Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"} />,
    );

    expect(container.querySelector("h5")?.classList.contains("uppercase")).toBe(true);
    const wrapper = container.querySelector<HTMLElement>(
      "[data-wide-markdown-block-kind='table']",
    );
    expect(wrapper?.classList.contains("rounded-lg")).toBe(true);
    expect(wrapper?.classList.contains("border")).toBe(true);
    expect(wrapper?.classList.contains("-mx-6")).toBe(false);
  });
});
