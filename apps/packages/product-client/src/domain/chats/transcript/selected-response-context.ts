export interface SelectedResponseContext {
  id: string;
  text: string;
  /** Optional user note attached to this annotation after "Add to chat". */
  comment?: string;
}

export interface SelectedResponseAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SelectedResponseSelection {
  text: string;
  anchorRect: SelectedResponseAnchorRect;
}

export interface SelectedResponsePromptPayload {
  text: string;
  blocks: Array<{ type: "text"; text: string }>;
  optimisticContentParts: Array<{ type: "text"; text: string }>;
}

// The model sees ONE plain-text message: each annotation is composed in as a
// numbered quoted section (matching the UI badge numbers) plus its optional
// comment — never structured message parts, and with no cap on the count.
export function buildPromptWithSelectedResponseContexts(
  promptText: string,
  contexts: readonly Pick<SelectedResponseContext, "text" | "comment">[],
): SelectedResponsePromptPayload {
  const sections = [
    promptText.trim(),
    ...contexts.map((context, index) => formatSelectedResponseContext(context, index + 1)),
  ].filter((section) => section.length > 0);
  const text = sections.join("\n\n");

  return {
    text,
    blocks: text ? [{ type: "text", text }] : [],
    optimisticContentParts: text ? [{ type: "text", text }] : [],
  };
}

function formatSelectedResponseContext(
  context: Pick<SelectedResponseContext, "text" | "comment">,
  ordinal: number,
): string {
  const quoted = context.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const comment = context.comment?.trim();
  return `Annotation ${ordinal}:\n\n${quoted}${comment ? `\n\nComment: ${comment}` : ""}`;
}
