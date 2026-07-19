import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PromptAttachmentCard } from "#product/components/workspace/chat/content/PromptAttachmentCard";

const testDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(testDir, "PromptAttachmentCard.tsx"), "utf8");
const componentCss = readFileSync(resolve(testDir, "PromptAttachmentCard.css"), "utf8");
const authenticatedCss = readFileSync(
  resolve(testDir, "../../../../app/authenticated.css"),
  "utf8",
);
const playgroundSource = readFileSync(
  resolve(testDir, "../../../playground/PlaygroundAttachmentFixtures.tsx"),
  "utf8",
);
const playgroundCss = readFileSync(
  resolve(testDir, "../../../playground/PlaygroundAttachmentFixtures.css"),
  "utf8",
);

describe("PromptAttachmentCard style ownership", () => {
  it("loads fixed card and reveal styles from the component-owned chunk", () => {
    expect(componentSource).toContain('import "./PromptAttachmentCard.css";');
    expect(componentSource).not.toContain("style={isDraft && !isImage");
    expect(componentSource).not.toContain("h-[52px]");
    expect(componentSource).not.toContain("w-[210px]");
    expect(componentCss).toMatch(
      /\.prompt-attachment-card-draft-file\s*\{[^}]*width:\s*210px;[^}]*height:\s*52px;/su,
    );
    expect(componentCss).toContain(
      ".prompt-attachment-card:hover .prompt-attachment-remove,",
    );
    expect(componentCss).toContain(".prompt-attachment-remove:focus-visible");
    expect(componentCss).toContain("pointer-events: auto;");
    expect(componentCss).toContain("opacity: 1;");
    expect(authenticatedCss).not.toContain("prompt-attachment-card");
    expect(authenticatedCss).not.toContain("prompt-attachment-remove");

    const html = renderToStaticMarkup(
      <PromptAttachmentCard
        sessionId={null}
        part={{
          type: "file",
          id: "draft-file",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 2048,
          sizeLabel: "2 KB",
          objectUrl: "blob:notes",
          source: "upload",
        }}
        variant="draft"
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain("prompt-attachment-card-draft-file");
    expect(html).toContain("max-w-full");
    expect(html).toContain("prompt-attachment-remove");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("opacity-0");
    expect(html).not.toContain("style=");
  });

  it("keeps the DEV aside width with its fixture owner", () => {
    expect(playgroundSource).toContain('import "./PlaygroundAttachmentFixtures.css";');
    expect(playgroundSource).toContain("playground-attachment-preview-aside");
    expect(playgroundSource).not.toContain('style={{ width: "26rem" }}');
    expect(playgroundSource).not.toContain("w-[26rem]");
    expect(playgroundCss).toMatch(
      /\.playground-attachment-preview-aside\s*\{[^}]*width:\s*26rem;/su,
    );
  });
});
