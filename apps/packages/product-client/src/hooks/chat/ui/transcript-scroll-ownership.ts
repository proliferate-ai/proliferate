import { PROGRAMMATIC_MATCH_TOL_PX } from "#product/hooks/chat/ui/transcript-row-list-model";

/**
 * A record of one programmatic write, awaiting the scroll event it produces.
 * `expectedTop` is the scrollTop the browser actually settled on after the
 * write (post-clamp), so the resulting event matches within a subpixel
 * tolerance. `frame` is the watchdog rAF that expires the marker if its event
 * never arrives (a clamped or no-op write), so a stale marker cannot leak into
 * the next user scroll. `id` is a monotonic sequence for identity.
 */
export interface ProgrammaticMarker {
  id: number;
  expectedTop: number;
  frame: number;
}

/**
 * Ownership markers: the PRIMARY classification signal `useTranscriptStickToBottom`
 * uses to tell its own writes apart from a user scroll. Every programmatic
 * write records a marker carrying the scrollTop it produced; the scroll event
 * that matches a live marker is our own write, not the user. A queue (not a
 * single slot) is required because the glue loop writes faster than the
 * browser dispatches scroll events, so several writes can be in flight at
 * once — a single slot would let a later write overwrite an earlier marker
 * before its event arrived, misclassifying that event as a user scroll (the
 * false-unpin the pixel-tolerance fallback used to paper over).
 *
 * Pure bookkeeping plus rAF scheduling: no React state, so it's usable and
 * testable independent of the hook's render lifecycle.
 */
export class TranscriptScrollOwnershipMarkers {
  private queue: ProgrammaticMarker[] = [];
  private seq = 0;

  /** Record a new in-flight programmatic write, expiring on the next frame if unmatched. */
  record(expectedTop: number): ProgrammaticMarker {
    const marker: ProgrammaticMarker = {
      id: (this.seq += 1),
      expectedTop,
      frame: 0,
    };
    this.queue.push(marker);
    // Watchdog: a write that changes nothing (or a browser clamp whose event
    // never arrives) must not leak its marker into the next user scroll.
    // Expire the marker on the next frame if its event has not consumed it
    // by then.
    marker.frame = requestAnimationFrame(() => {
      marker.frame = 0;
      this.remove(marker);
    });
    return marker;
  }

  /** Drop one marker from the queue (event consumed it, or the watchdog expired it). */
  remove(marker: ProgrammaticMarker): void {
    const index = this.queue.indexOf(marker);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    if (marker.frame !== 0) {
      cancelAnimationFrame(marker.frame);
      marker.frame = 0;
    }
  }

  /** Cancel every live marker's watchdog and empty the queue (session reset / unmount). */
  clear(): void {
    for (const marker of this.queue) {
      if (marker.frame !== 0) {
        cancelAnimationFrame(marker.frame);
      }
    }
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }

  /**
   * PRIMARY classification tier: a live marker recorded by one of our own
   * writes owns this event. Matched by VALUE (not FIFO position) because the
   * browser can coalesce or reorder delivery relative to write order.
   * Consumes and returns the matching marker, or null if none matches.
   */
  matchByValue(top: number, tolerancePx = PROGRAMMATIC_MATCH_TOL_PX): ProgrammaticMarker | null {
    const matchIndex = this.queue.findIndex(
      (marker) => Math.abs(top - marker.expectedTop) <= tolerancePx,
    );
    if (matchIndex === -1) {
      return null;
    }
    const marker = this.queue[matchIndex];
    this.remove(marker);
    return marker;
  }

  /**
   * FALLBACK tier (last resort, engaged only while a marker is live): the
   * tolerance missed because scrollHeight changed between our write and this
   * event. While pinned, a downward-or-flat move is our own snap catching
   * up, never a user scroll; unpinning here would be a false positive.
   * Consumes and returns the latest marker if this event qualifies, or null.
   */
  matchDownwardWhilePinned(top: number, tolerancePx = PROGRAMMATIC_MATCH_TOL_PX): ProgrammaticMarker | null {
    if (this.queue.length === 0) {
      return null;
    }
    const latest = this.queue[this.queue.length - 1];
    if (top < latest.expectedTop - tolerancePx) {
      return null;
    }
    this.remove(latest);
    return latest;
  }
}
