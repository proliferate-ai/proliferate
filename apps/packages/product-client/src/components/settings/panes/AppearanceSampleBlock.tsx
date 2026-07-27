import { DiffViewer } from "#product/components/content/ui/DiffViewer";

/**
 * Sample block for the Appearance pane: one bordered panel that makes every
 * choice on the page legible without leaving Settings — the UI type steps and
 * the code surface, in that order.
 *
 * The code half is a real before/after diff shown side by side rather than a
 * plain snippet: the diff surface is where code styling is hardest to judge,
 * and the addition/deletion tints and gutter numbers only exist there.
 */
const SAMPLE_PATCH = [
  "@@ -1,5 +1,5 @@",
  " const themePreview: ThemeConfig = {",
  '-  surface: "sidebar",',
  '-  accent: "azure",',
  "-  contrast: 42,",
  '+  surface: "sidebar-elevated",',
  '+  accent: "cyan",',
  "+  contrast: 68,",
  " };",
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
        <DiffViewer
          patch={SAMPLE_PATCH}
          filePath="theme-preview.ts"
          layout="split"
          wrapLongLines
          chainVerticalWheel={false}
        />
      </div>
    </div>
  );
}
