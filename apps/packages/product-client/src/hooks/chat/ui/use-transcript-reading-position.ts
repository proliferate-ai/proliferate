import { useCallback, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { TranscriptRenderableRow } from "#product/hooks/chat/ui/transcript-row-list-model";
import {
  getReadingPosition,
  recordReadingPosition,
  resolveTranscriptReadingAnchor,
  resolveTranscriptRestoreTargetTop,
  type TranscriptSessionRestorePlan,
} from "#product/hooks/chat/ui/transcript-reading-position-store";

export interface UseTranscriptReadingPositionOptions {
  /** `${workspaceId}:${sessionId}` — the same identity the engine scopes to. */
  sessionKey: string;
  /**
   * Whether the session is actively streaming (working / needs_input). FR-2:
   * streaming sessions bottom-pin on entry; only finalized sessions restore.
   */
  isSessionBusy: boolean;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  renderableRows: readonly TranscriptRenderableRow[];
}

export interface TranscriptReadingPosition {
  /** Persist the reader's current top-visible row + offset for this session. */
  captureReadingPosition: (viewport: HTMLDivElement) => void;
  /**
   * Build the placement plan for the CURRENT session identity: bottom for a
   * streaming session or one with no saved position; otherwise a restore whose
   * resolver inverts the saved {rowKey, offset} against live measured geometry.
   */
  buildSessionRestorePlan: () => TranscriptSessionRestorePlan;
}

/**
 * FR-2 (rung 6, PRO-187) reading-position wiring for the virtualized transcript.
 * Captures the reader's position on every scroll and, on a session switch,
 * produces the placement plan the stick-to-bottom engine's resetForSession
 * consumes. The virtualizer is a stable instance, so both callbacks are
 * referentially stable; live row/session/busy state is read through refs so the
 * session-switch layout effect that consumes the plan fires ONLY on the switch,
 * never when streaming state or the row snapshot churns mid-session.
 */
export function useTranscriptReadingPosition({
  sessionKey,
  isSessionBusy,
  virtualizer,
  renderableRows,
}: UseTranscriptReadingPositionOptions): TranscriptReadingPosition {
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const isSessionBusyRef = useRef(isSessionBusy);
  isSessionBusyRef.current = isSessionBusy;
  const renderableRowsRef = useRef(renderableRows);
  renderableRowsRef.current = renderableRows;

  const captureReadingPosition = useCallback((viewport: HTMLDivElement) => {
    const anchor = resolveTranscriptReadingAnchor(
      virtualizer.getVirtualItems(),
      viewport.scrollTop,
      renderableRowsRef.current,
    );
    if (anchor) {
      recordReadingPosition(sessionKeyRef.current, anchor);
    }
  }, [virtualizer]);

  const buildSessionRestorePlan = useCallback((): TranscriptSessionRestorePlan => {
    if (isSessionBusyRef.current) {
      return { kind: "bottom" };
    }
    const saved = getReadingPosition(sessionKeyRef.current);
    if (!saved) {
      return { kind: "bottom" };
    }
    return {
      kind: "restore",
      resolveTargetTop: () =>
        resolveTranscriptRestoreTargetTop(
          (index) => virtualizer.getOffsetForIndex(index, "start")?.[0] ?? null,
          renderableRowsRef.current,
          saved,
        ),
    };
  }, [virtualizer]);

  return { captureReadingPosition, buildSessionRestorePlan };
}
