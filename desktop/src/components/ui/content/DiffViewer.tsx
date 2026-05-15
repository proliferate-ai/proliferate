import type { CSSProperties } from "react";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { ChatDiffViewer } from "@/components/ui/content/diff/ChatDiffViewer";
import { SplitDiffViewer } from "@/components/ui/content/diff/SplitDiffViewer";
import { UnifiedDiffViewer } from "@/components/ui/content/diff/UnifiedDiffViewer";
import { useDiffHighlight } from "@/hooks/ui/use-diff-highlight";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";

interface DiffViewerProps {
  patch: string;
  filePath?: string;
  className?: string;
  viewportClassName?: string;
  wrapLongLines?: boolean;
  variant?: "default" | "chat";
  layout?: "unified" | "split";
  operationId?: MeasurementOperationId | null;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
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
  overscrollBehavior,
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
          wrapLongLines={wrapLongLines}
          overscrollBehavior={overscrollBehavior}
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
          overscrollBehavior={overscrollBehavior}
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
        overscrollBehavior={overscrollBehavior}
      />
    </DebugProfiler>
  );
}
