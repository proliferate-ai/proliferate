import type { ReactNode } from "react";
import { CodeBlock } from "#product/components/content/ui/CodeBlock";
import { MermaidDiagram } from "#product/components/workspace/chat/transcript/MermaidDiagram";
import type { MarkdownCodeBlockRenderInput } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { useHighlightedTokens } from "#product/hooks/ui/highlighting/use-highlighted-tokens";
import { isMermaidLanguage } from "#product/lib/domain/chat/transcript/mermaid-fence";

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
  if (isMermaidLanguage(language)) {
    return <MermaidDiagram code={code} language={language} />;
  }
  return <DesktopCodeBlock code={code} language={language} />;
}
