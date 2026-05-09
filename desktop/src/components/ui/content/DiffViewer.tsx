import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { ChatDiffViewer } from "@/components/ui/content/diff/ChatDiffViewer";
import { SplitDiffViewer } from "@/components/ui/content/diff/SplitDiffViewer";
import { UnifiedDiffViewer } from "@/components/ui/content/diff/UnifiedDiffViewer";
import { useDiffHighlight } from "@/hooks/ui/use-diff-highlight";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";

interface DiffViewerProps {
  patch: string;
  filePath?: string;
  className?: string;
  viewportClassName?: string;
  wrapLongLines?: boolean;
  variant?: "default" | "chat";
  layout?: "unified" | "split";
  operationId?: MeasurementOperationId | null;
}

const ROOT_CLASS =
  "font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]";

export function DiffViewer({
  patch,
  filePath,
  className,
  viewportClassName,
  wrapLongLines = false,
  variant = "default",
  layout = "unified",
  operationId,
}: DiffViewerProps) {
  const { parsed, tokens } = useDiffHighlight(patch, filePath, operationId);

  if (variant === "chat") {
    return (
      <DebugProfiler id="diff-viewer">
        <ChatDiffViewer
          parsed={parsed}
          tokens={tokens}
          className={className}
          viewportClassName={viewportClassName}
        />
      </DebugProfiler>
    );
  }

  const rootClass = `${ROOT_CLASS} ${className ?? ""}`;

  if (layout === "split") {
    return (
      <DebugProfiler id="diff-viewer">
        <SplitDiffViewer
          parsed={parsed}
          tokens={tokens}
          className={rootClass}
          viewportClassName={viewportClassName}
        />
      </DebugProfiler>
    );
  }

  return (
    <DebugProfiler id="diff-viewer">
      <UnifiedDiffViewer
        parsed={parsed}
        tokens={tokens}
        className={rootClass}
        viewportClassName={viewportClassName}
        wrapLongLines={wrapLongLines}
        variant={variant}
      />
    </DebugProfiler>
  );
}
