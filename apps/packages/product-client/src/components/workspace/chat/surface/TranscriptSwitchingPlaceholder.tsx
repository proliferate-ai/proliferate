import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";

/**
 * The chat pane's switch/load wait state: a centered activity cell instead of
 * fake message skeletons (PRO-182 — a clean loader reads better than a
 * transient skeleton that content immediately replaces). The delayed
 * `content-fade-in` keeps sub-200ms switches loader-free so fast paths never
 * flash it.
 */
export function TranscriptSwitchingPlaceholder({
  label = "Loading chat",
}: {
  label?: string;
}) {
  return (
    <DebugProfiler id="session-transcript-pane">
      <div
        className={`flex h-full min-h-0 overflow-hidden py-4 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
        role="status"
        aria-label={label}
        data-chat-switching-placeholder
      >
        <div
          className={`${CHAT_COLUMN_CLASSNAME} flex flex-1 flex-col items-center justify-center gap-3 animate-content-fade-in [animation-delay:var(--duration-disclosure)] [animation-fill-mode:backwards]`}
          aria-hidden="true"
        >
          <DotCellLoader className="text-muted-foreground" variant="wave" />
          <p className="text-chat font-medium text-muted-foreground">{label}</p>
        </div>
      </div>
    </DebugProfiler>
  );
}
