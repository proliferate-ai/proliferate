import { CODE_BLOCK_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { CodeBlock } from "#product/components/content/ui/CodeBlock";
import { useHighlightedTokens } from "#product/hooks/ui/highlighting/use-highlighted-tokens";
import { useResolvedMode } from "#product/hooks/theme/derived/use-resolved-mode";
import {
  useMarkdownFencedCodeStart,
  useMarkdownStreamingSource,
} from "#product/components/workspace/chat/transcript/MarkdownBody";
import {
  isIncompleteStreamingMermaidFence,
} from "#product/lib/domain/chat/transcript/mermaid-fence";
import { renderMermaidDiagram } from "#product/lib/infra/mermaid/mermaid-renderer";
import { isBlockedDiagramUrl } from "#product/lib/infra/mermaid/mermaid-svg";
import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

const DIAGRAM_VIEWPORT_CLASSNAME =
  `${CODE_BLOCK_MAX_HEIGHT_CLASS} min-w-0 w-full max-w-full p-3 text-chat font-normal`;

/**
 * Fenced mermaid block: diagram when the fence is complete and mermaid can
 * render it; otherwise the existing highlighted CodeBlock, including copy of
 * the original source.
 */
export function MermaidDiagram({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const streaming = useMarkdownStreamingSource();
  const fenceStart = useMarkdownFencedCodeStart();
  const incomplete = isIncompleteStreamingMermaidFence({
    source: streaming.source,
    code,
    language,
    isStreaming: streaming.isStreaming,
    startOffset: fenceStart.startOffset,
    startLine: fenceStart.startLine,
  });
  const mode = useResolvedMode();
  const tokens = useHighlightedTokens(code, language ?? "text");
  const svg = useMermaidSvg(code, mode, !incomplete);

  if (!svg) {
    return <CodeBlock code={code} label={language} tokens={tokens} />;
  }

  return (
    <CodeBlock
      code={code}
      label={language}
      viewportClassName={DIAGRAM_VIEWPORT_CLASSNAME}
    >
      <div
        role="img"
        aria-label="Mermaid diagram"
        data-mermaid-diagram="true"
        className="min-w-0 max-w-full"
        onClick={handleMermaidLinkClick}
      >
        <div
          className="min-w-0 max-w-full [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </CodeBlock>
  );
}

function useMermaidSvg(
  code: string,
  mode: "dark" | "light",
  enabled: boolean,
): string | null {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    setSvg(null);
    void renderMermaidDiagram({
      source: code,
      mode,
      themeVariables: readMermaidThemeVariables(),
    }).then((result) => {
      if (!cancelled) {
        setSvg(result);
      }
    }).catch(() => {
      if (!cancelled) {
        setSvg(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, enabled, mode]);

  return svg;
}

function readMermaidThemeVariables(): Record<string, string> {
  if (typeof document === "undefined") {
    return {};
  }
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const background = token("--color-card") || token("--color-background");
  const foreground = token("--color-foreground");
  const border = token("--color-border");
  const muted = token("--color-muted");
  const mutedForeground = token("--color-muted-foreground");
  const link = token("--color-link-foreground");
  const fontFamily = token("--font-sans");
  return {
    background,
    primaryColor: muted || background,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    lineColor: foreground,
    secondaryColor: muted || background,
    tertiaryColor: token("--color-background") || background,
    nodeTextColor: foreground,
    mainBkg: background,
    clusterBkg: muted || background,
    titleColor: foreground,
    edgeLabelBackground: background,
    clusterBorder: border,
    tertiaryTextColor: mutedForeground,
    tertiaryBorderColor: border,
    primaryLinkColor: link,
    fontFamily,
  };
}

function handleMermaidLinkClick(event: ReactMouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof SVGAElement)) {
    return;
  }
  const href = anchor.href.baseVal;
  event.preventDefault();
  event.stopPropagation();
  if (!href || isBlockedDiagramUrl(href)) {
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
