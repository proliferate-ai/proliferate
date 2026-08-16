import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { ProliferateLivingMark } from "#product/components/brand/ProliferateLivingMark";
import { LoadingBoundary } from "#product/primitives/LoadingBoundary";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";

/**
 * The chat pane's switch/load wait state: a centered activity cell instead of
 * fake message skeletons (PRO-182 — a clean loader reads better than a
 * transient skeleton that content immediately replaces).
 *
 * The show-delay is no longer a hand-rolled `content-fade-in` + animation-delay:
 * this surface routes through the shared `LoadingBoundary` (UX Latency +
 * Transitions ADR §4.2, Rung 2), which owns the 200ms show-delay so sub-200ms
 * switches stay loader-free. The component is only mounted while switching, so it
 * holds `state="pending"` for its whole life; the parent unmounts it on resolve.
 * Rung 3 (UX Latency + Transitions ADR §4.3) swaps the treatment visual from
 * `DotCellLoader` to the Class A `ProliferateLivingMark`.
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
        <LoadingBoundary
          state="pending"
          diagnostics={{ flow: "transcript_switch" }}
          className={`${CHAT_COLUMN_CLASSNAME} flex flex-1 flex-col items-center justify-center gap-3`}
          aria-hidden="true"
          treatment={
            <>
              <ProliferateLivingMark />
              <p className="text-chat font-medium text-muted-foreground">{label}</p>
            </>
          }
        />
      </div>
    </DebugProfiler>
  );
}
