import type { ReactNode } from "react";
import { AssistantMessage } from "@proliferate/ui";

/** The transcript thread column an assistant turn is measured against. */
const ThreadColumn = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-2xl">{children}</div>
);

const SETTLED = `Both composer control rows now route through the same frame, so the
8px cluster gap is defined once.

**What changed**

- \`ChatComposerControlRowFrame\` owns the three-column grid
- \`CloudChatComposerControlStrip\` re-uses it instead of re-declaring gaps
- the send affordance stays in the trailing cluster

The remaining difference is the cloud strip's workspace chip, which has no
desktop equivalent.`;

const WITH_CODE = `Here is the reducer branch that drops an ambiguous export.

\`\`\`ts
export function makeEntry(subpaths: string[], pins: Pin[]): string {
  const lines = subpaths.map((p) => \`export * from "\${p}";\`);
  return [...lines, ...pins.map(pinLine)].join("\\n");
}
\`\`\`

Three names collide across two subpaths — \`Checkbox\`, \`Tooltip\` and
\`Spinner\` — so each is pinned explicitly.`;

const WITH_TABLE = `## Capture surface comparison

| Surface | Owner | Overflow contract |
| --- | --- | --- |
| Assistant transcript | product-ui MarkdownBody | table scrolls inside the message |
| Hosted web transcript | shared renderer | chat column never widens |

> Presentation should make structure easier to scan while preserving
> selection, copying, and the original Markdown semantics.

1. Build the bundle
2. Capture each story at \`?story=\`
3. Grade from the contact sheet`;

const STREAMING = `Walking \`apps/packages/product-ui/src\` for every component that has no
playground registry entry. So far the composer frames, the transcript row
provider, and the billing panes all read their props from a controller layer
rather than a fixture, which means the`;

export const SettledResponse = () => (
  <ThreadColumn>
    <AssistantMessage content={SETTLED} />
  </ThreadColumn>
);

export const WithCodeBlock = () => (
  <ThreadColumn>
    <AssistantMessage content={WITH_CODE} />
  </ThreadColumn>
);

export const WithTableAndQuote = () => (
  <ThreadColumn>
    <AssistantMessage content={WITH_TABLE} />
  </ThreadColumn>
);

/**
 * A live message: `isStreaming` opts the tail into the defensive parse.
 * `animateReveal={false}` pins the reveal frontier at the end of the source so
 * a still frame shows the whole painted prefix instead of a random mid-fade.
 */
export const StreamingTail = () => (
  <ThreadColumn>
    <AssistantMessage content={STREAMING} isStreaming animateReveal={false} />
  </ThreadColumn>
);
