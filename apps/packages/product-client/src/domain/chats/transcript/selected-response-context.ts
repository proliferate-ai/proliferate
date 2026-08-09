export interface SelectedResponseContext {
  id: string;
  text: string;
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

const SELECTED_RESPONSE_PREVIEW_CHARACTER_LIMIT = 220;

export function selectedResponseContextPreview(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= SELECTED_RESPONSE_PREVIEW_CHARACTER_LIMIT) {
    return compact;
  }

  return `${compact.slice(0, SELECTED_RESPONSE_PREVIEW_CHARACTER_LIMIT - 3).trimEnd()}...`;
}

export function buildPromptWithSelectedResponseContexts(
  promptText: string,
  contexts: readonly Pick<SelectedResponseContext, "text">[],
): SelectedResponsePromptPayload {
  const sections = [
    promptText.trim(),
    ...contexts.map((context) => formatSelectedResponseContext(context.text)),
  ].filter((section) => section.length > 0);
  const text = sections.join("\n\n");

  return {
    text,
    blocks: text ? [{ type: "text", text }] : [],
    optimisticContentParts: text ? [{ type: "text", text }] : [],
  };
}

function formatSelectedResponseContext(text: string): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `Selected response text:\n\n${quoted}`;
}
