import { AssistantMessage } from "#product/components/workspace/chat/transcript/AssistantMessage";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "#product/components/workspace/chat/transcript/transcript-markdown";
import type { ScenarioKey } from "#product/config/playground";
import { TranscriptPreviewShell } from "#product/components/playground/transcript/PlaygroundTranscriptShell";

export const MARKDOWN_PRESENTATION_FIXTURE = `# Markdown presentation

This settled response demonstrates **strong emphasis**, *italic emphasis*, and a [web link](https://github.com/proliferate-ai/proliferate) without changing the source text.

## Hierarchy and rhythm

### Lists stay legible

- Unordered item with \`inline code\`
- Nested structure
  - Second-level item
    - Third-level item
- File references keep their renderer: [MarkdownBody.tsx](/Users/pablohansen/proliferate/apps/packages/product-ui/src/chat/transcript/MarkdownBody.tsx)

1. First ordered item
2. Second ordered item
   1. Nested ordered item
   2. Another nested item

#### Blockquotes and code

> Presentation should make structure easier to scan while preserving selection, copying, and the original Markdown semantics.

Inline \`const readable = true\` keeps a monospace face at the surrounding prose size.

\`\`\`ts
export function presentation(value: string): string {
  return value.trim();
}
\`\`\`

##### Wide tables

| Surface | Presentation owner | Font contract | Overflow contract | Copy affordance | Link behavior |
| --- | --- | --- | --- | --- | --- |
| Assistant transcript | product-ui MarkdownBody | prose-sized inline and fenced code | table scrolls inside the message | code button stays visible | workspace files keep file renderer |
| Hosted web transcript | shared product-ui renderer | semantic UI-size tokens | chat column never widens | plain highlighted fallback | external links keep provider renderer |

###### Supporting detail

The smallest heading remains distinct but restrained, and the final paragraph closes the fixture without extra outer spacing.`;

export function renderPlaygroundMarkdownTranscript(
  scenario: ScenarioKey,
) {
  if (scenario !== "markdown-presentation") {
    return null;
  }

  return (
    <TranscriptPreviewShell>
      <div data-markdown-presentation-fixture="settled">
        <AssistantMessage
          content={MARKDOWN_PRESENTATION_FIXTURE}
          renderLink={renderTranscriptLink}
          renderInlineCode={renderTranscriptInlineCode}
          renderCodeBlock={renderTranscriptCodeBlock}
        />
      </div>
    </TranscriptPreviewShell>
  );
}
