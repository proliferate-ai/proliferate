import type { ReactNode } from "react";
import { CodeBlock } from "@proliferate/product-ui/code/CodeBlock";
import type { MarkdownCodeBlockRenderInput } from "@proliferate/product-ui/chat/transcript/MarkdownBody";
import { useHighlightedTokens } from "@/hooks/ui/highlighting/use-highlighted-tokens";

/**
 * Desktop code-block renderer injected into MarkdownBody's renderCodeBlock
 * prop. Renders fenced code using token-based highlighting via the shared
 * CodeBlock primitive.
 */
function DesktopCodeBlock({ code, language }: { code: string; language: string | null }) {
  const tokens = useHighlightedTokens(code, language ?? "text");
  return <CodeBlock code={code} label={language} tokens={tokens} />;
}

export function renderDesktopCodeBlock({
  code,
  language,
}: MarkdownCodeBlockRenderInput): ReactNode {
  return <DesktopCodeBlock code={code} language={language} />;
}
