import "./fixture.css";
import { createRoot } from "react-dom/client";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { renderTranscriptCodeBlock } from "#product/components/workspace/chat/transcript/transcript-markdown";
import { CHAT_COLUMN_CLASSNAME } from "#product/config/chat-layout";
import { MERMAID_TRANSCRIPT_MARKDOWN } from "#product/app/authenticated-mermaid-transcript-content";

function mountColumn(parentId: string) {
  const parent = document.getElementById(parentId);
  if (!parent) {
    throw new Error(`Mermaid transcript fixture is missing #${parentId}.`);
  }
  const column = document.createElement("div");
  column.className = CHAT_COLUMN_CLASSNAME;
  column.dataset.transcriptColumn = "true";
  parent.appendChild(column);
  createRoot(column).render(
    <MarkdownBody
      content={MERMAID_TRANSCRIPT_MARKDOWN}
      renderCodeBlock={renderTranscriptCodeBlock}
    />,
  );
}

mountColumn("narrow-parent");
mountColumn("desktop-parent");
