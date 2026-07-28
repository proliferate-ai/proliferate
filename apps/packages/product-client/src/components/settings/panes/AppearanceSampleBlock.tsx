import { HighlightedCodeBlock } from "#product/components/content/ui/HighlightedCodeBlock";

/**
 * Sample block for the Appearance pane: one bordered panel that makes every
 * choice on the page legible without leaving Settings — the UI type steps and
 * the code surface, in that order.
 *
 * The code half is a plain highlighted snippet, NOT a diff. A diff answers
 * "how do added and removed lines look", which is not the question this pane
 * asks: the settings above it scale UI text and code text, and a reader
 * checking whether their code size is comfortable should see ordinary code at
 * that size. The diff's row tints and change gutter were the loudest thing in
 * the panel and pulled the eye to a state that only occurs while reviewing a
 * change. Code with syntax highlighting and line numbers exercises exactly what
 * the settings control — the mono family, the readable-code step, and the token
 * palette — with nothing else competing.
 */
const SAMPLE_CODE = [
  "type ThemeConfig = {",
  "  surface: string;",
  "  accent: string;",
  "  contrast: number;",
  "};",
  "",
  "export function resolveTheme(config: ThemeConfig) {",
  "  const contrast = Math.min(100, Math.max(0, config.contrast));",
  "  return { ...config, contrast, resolvedAt: Date.now() };",
  "}",
].join("\n");

export function AppearanceSampleBlock() {
  return (
    <div className="isolate overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-1.5 px-4 py-3.5">
        <p className="text-heading font-medium text-foreground">Sample heading</p>
        <p className="text-body text-foreground">
          Body text at the size agents and chat use, with{" "}
          <code className="font-mono text-readable-code text-foreground">inline code</code>{" "}
          in the middle of a sentence.
        </p>
        <p className="text-ui-sm text-muted-foreground">
          Secondary text, the size used for descriptions and timestamps.
        </p>
      </div>
      <div className="border-t border-border">
        {/* No border/radius of its own: the block is flush inside the panel that
            already frames it, so the sample reads as one surface split into a
            type half and a code half rather than a card inside a card. */}
        <HighlightedCodeBlock
          code={SAMPLE_CODE}
          language="typescript"
          showLanguageLabel={false}
          showCopyButton={false}
          showLineNumbers
          className="rounded-none border-0 bg-transparent"
        />
      </div>
    </div>
  );
}
