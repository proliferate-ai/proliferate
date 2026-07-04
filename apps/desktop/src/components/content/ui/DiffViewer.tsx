import type { CSSProperties } from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { ChatDiffViewer } from "@/components/content/ui/diff/ChatDiffViewer";
import { SplitDiffViewer } from "@/components/content/ui/diff/SplitDiffViewer";
import { UnifiedDiffViewer } from "@/components/content/ui/diff/UnifiedDiffViewer";
import { useDiffHighlight } from "@/hooks/ui/highlighting/use-diff-highlight";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { useChatDiffPreferencesStore } from "@/stores/chat/chat-diff-preferences-store";

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
  /**
   * Full file content (new-side) split into lines. When provided, enables
   * Codex-style per-gap context expansion. Without this, gap separators
   * are still rendered but expansion is disabled.
   */
  fileLines?: string[];
  /**
   * Lazy fetch trigger for `fileLines`, invoked on the first expander
   * interaction. When provided, expanders are interactive even before
   * `fileLines` arrives.
   */
  onRequestFileLines?: () => void;
}

const ROOT_CLASS =
  "font-mono text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)]";

export function DiffViewer({
  patch,
  filePath,
  className,
  viewportClassName,
  wrapLongLines,
  variant = "default",
  layout = "unified",
  operationId,
  contentSearchUnitId,
  overscrollBehavior,
  overscrollBehaviorX,
  overscrollBehaviorY,
  chainVerticalWheel,
  fileLines,
  onRequestFileLines,
}: DiffViewerProps) {
  const { parsed, tokens } = useDiffHighlight(patch, filePath, operationId);
  const chatWrapLongLines = useChatDiffPreferencesStore((state) =>
    variant === "chat" ? state.wrapLongLines : false
  );
  const effectiveWrapLongLines = wrapLongLines ?? chatWrapLongLines;

  if (variant === "chat") {
    return (
      <DebugProfiler id="diff-viewer">
        <ChatDiffViewer
          parsed={parsed}
          tokens={tokens}
          className={className}
          viewportClassName={viewportClassName}
          wrapLongLines={effectiveWrapLongLines}
          filePath={filePath}
          contentSearchUnitId={contentSearchUnitId}
          overscrollBehavior={overscrollBehavior}
          overscrollBehaviorX={overscrollBehaviorX}
          overscrollBehaviorY={overscrollBehaviorY}
          chainVerticalWheel={chainVerticalWheel}
          fileLines={fileLines}
          onRequestFileLines={onRequestFileLines}
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
          wrapLongLines={effectiveWrapLongLines}
          overscrollBehavior={overscrollBehavior}
          overscrollBehaviorX={overscrollBehaviorX}
          overscrollBehaviorY={overscrollBehaviorY}
          chainVerticalWheel={chainVerticalWheel}
          fileLines={fileLines}
          onRequestFileLines={onRequestFileLines}
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
        wrapLongLines={effectiveWrapLongLines}
        variant={variant}
        overscrollBehavior={overscrollBehavior}
        overscrollBehaviorX={overscrollBehaviorX}
        overscrollBehaviorY={overscrollBehaviorY}
        chainVerticalWheel={chainVerticalWheel}
        fileLines={fileLines}
        onRequestFileLines={onRequestFileLines}
      />
    </DebugProfiler>
  );
}
