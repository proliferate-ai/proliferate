import type { CSSProperties } from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { ChatDiffViewer } from "@/components/content/ui/diff/ChatDiffViewer";
import { SplitDiffViewer } from "@/components/content/ui/diff/SplitDiffViewer";
import { UnifiedDiffViewer } from "@/components/content/ui/diff/UnifiedDiffViewer";
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
  contentSearchUnitId?: string;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  chainVerticalWheel?: boolean;
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
  contentSearchUnitId,
  overscrollBehavior,
  overscrollBehaviorX,
  overscrollBehaviorY,
  chainVerticalWheel,
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
          filePath={filePath}
          contentSearchUnitId={contentSearchUnitId}
          overscrollBehavior={overscrollBehavior}
          overscrollBehaviorX={overscrollBehaviorX}
          overscrollBehaviorY={overscrollBehaviorY}
          chainVerticalWheel={chainVerticalWheel}
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
          wrapLongLines={wrapLongLines}
          overscrollBehavior={overscrollBehavior}
          overscrollBehaviorX={overscrollBehaviorX}
          overscrollBehaviorY={overscrollBehaviorY}
          chainVerticalWheel={chainVerticalWheel}
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
        overscrollBehaviorX={overscrollBehaviorX}
        overscrollBehaviorY={overscrollBehaviorY}
        chainVerticalWheel={chainVerticalWheel}
      />
    </DebugProfiler>
  );
}
