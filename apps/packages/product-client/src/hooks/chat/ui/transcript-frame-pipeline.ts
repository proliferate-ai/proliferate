/**
 * One per-frame mutate-then-snap pipeline for the transcript scroll path.
 *
 * Rung 4 (PRO-187) replaces the N independent requestAnimationFrame loops that
 * used to fight over the transcript viewport — session re-entry glue, submit
 * re-pin glue, tab-resume glue, and above-change compensation — with a single
 * owned scheduler. Within a frame the browser commits mutations (React commits,
 * virtualizer re-measurement, reveal height growth) first; THEN this pipeline
 * runs EXACTLY ONE snap/compensation pass in the same frame's layout phase
 * before paint. Interleaving between independent loops (the visible jank rung 4
 * removes) cannot happen because there is only ever one writer and one pass.
 *
 * WHO owns a scroll write is still the rung-3 ownership-marker system
 * (`notifyProgrammaticScroll` / `TranscriptScrollOwnershipMarkers`). This
 * pipeline owns only WHEN writes happen. The single frame pass reads pin state
 * and either snaps to the follow target (pinned) or applies an above-change
 * compensation delta (unpinned with an active anchor); it never classifies.
 *
 * "Glue" (Q3) is no longer a family of separate rAF loops. It is the pipeline
 * snapping each frame while a mutation burst is still landing, terminating when
 * the content ResizeObserver goes quiet (height stable for a frame) OR the hard
 * cap below elapses — whichever comes first. Steady-state streaming follow does
 * NOT rely on the glue window: the content ResizeObserver requests a single
 * frame pass on every growth while pinned, for as long as the stream grows.
 *
 * Pure bookkeeping plus rAF scheduling: no React state, so it is usable and
 * testable independent of any hook's render lifecycle. Timer primitives are
 * injectable for deterministic unit tests.
 */

// Q3: the glue window's hard cap. A mutation burst (freshly mounted rows
// re-measuring, a composer collapse settling) is expected to quiesce well
// inside this budget; the cap only bounds a pathological never-quiet source so
// the forced-glue window can never run away. Steady-state follow continues
// past it through the content ResizeObserver's per-growth frame requests.
export const TRANSCRIPT_GLUE_MAX_MS = 250;

// The content ResizeObserver "going quiet" is observed as the measured height
// holding stable across consecutive frame passes. One stable frame ends the
// forced-glue window; continued growth is picked back up by the steady-state
// per-growth frame request, so ending eagerly here costs nothing and keeps the
// window tight.
const GLUE_SETTLE_QUIET_FRAMES = 1;

/**
 * The single snap/compensation writer the pipeline drives. Supplied once by the
 * stick-to-bottom engine, which owns pin state and the follow target.
 */
export interface TranscriptFrameWriter {
  /**
   * Run the one write for this frame: snap to the follow target while pinned,
   * apply the active above-change compensation delta while unpinned, or do
   * nothing. All writes flow through the rung-3 ownership markers inside.
   */
  runFramePass: () => void;
  /**
   * Current content height, used only to detect the content ResizeObserver
   * going quiet during a forced-glue window. Returns the live `scrollHeight`.
   */
  measureContentHeight: () => number;
  /**
   * Whether the pipeline should keep the forced-glue window alive. False when
   * the viewport is gone or the user has reclaimed control (unpinned with no
   * active compensation anchor).
   */
  shouldContinueGlue: () => boolean;
}

type RafFn = (cb: () => void) => number;
type CafFn = (handle: number) => void;
type NowFn = () => number;

function defaultRaf(cb: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(cb);
  }
  return 0;
}

function defaultCaf(handle: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
  }
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export class TranscriptFramePipeline {
  private writer: TranscriptFrameWriter | null = null;

  // A single-shot frame scheduled by a mutation source outside the glue window.
  // `framePending` is the source of truth (a synchronously-firing rAF — e.g. a
  // test's rAF stub — clobbers the returned handle AFTER the callback nulls it,
  // so the boolean, set inside the callback, is the reliable signal).
  private framePending = false;
  private frameHandle: number | null = null;
  // The self-driving forced-glue window (session entry / submit / tab resume).
  // `glueActive` is likewise the source of truth for the same reentrancy reason.
  private glueActive = false;
  private glueHandle: number | null = null;
  private glueStartedAt = 0;
  private glueLastHeight = -1;
  private glueQuietFrames = 0;

  constructor(
    private readonly raf: RafFn = defaultRaf,
    private readonly caf: CafFn = defaultCaf,
    private readonly now: NowFn = defaultNow,
  ) {}

  /** Wire the single snap/compensation writer. */
  setWriter(writer: TranscriptFrameWriter): void {
    this.writer = writer;
  }

  /**
   * A mutation source (content ResizeObserver, an above-change anchor set, a
   * pinned snap effect) requests the one frame pass. Coalesces: many calls in
   * one tick schedule a single frame that runs `runFramePass` exactly once. A
   * no-op while a forced-glue window is already snapping every frame.
   */
  requestFrame(): void {
    if (this.glueActive || this.framePending) {
      return;
    }
    this.framePending = true;
    this.frameHandle = this.raf(() => {
      this.framePending = false;
      this.frameHandle = null;
      this.writer?.runFramePass();
    });
  }

  /**
   * Begin a forced-glue window: snap every frame while the mutation burst
   * lands, terminating when the content ResizeObserver goes quiet or the hard
   * cap elapses. Used for session re-entry, submit re-pin, and tab/window
   * resume — each an explicit return-to-bottom intent whose freshly mounted or
   * resumed measurement backlog must collapse into one silent jump.
   */
  beginGlue(): void {
    if (this.writer == null) {
      return;
    }
    // Fold any pending single-shot frame into the window.
    if (this.frameHandle != null) {
      this.caf(this.frameHandle);
    }
    this.framePending = false;
    this.frameHandle = null;
    if (this.glueHandle != null) {
      this.caf(this.glueHandle);
    }
    this.glueActive = true;
    this.glueStartedAt = this.now();
    this.glueLastHeight = -1;
    this.glueQuietFrames = 0;
    this.glueHandle = this.raf(this.glueTick);
  }

  private glueTick = (): void => {
    const writer = this.writer;
    if (writer == null || !writer.shouldContinueGlue()) {
      this.glueActive = false;
      return;
    }
    writer.runFramePass();

    const height = writer.measureContentHeight();
    if (height === this.glueLastHeight) {
      this.glueQuietFrames += 1;
    } else {
      this.glueQuietFrames = 0;
      this.glueLastHeight = height;
    }

    const capElapsed = this.now() - this.glueStartedAt >= TRANSCRIPT_GLUE_MAX_MS;
    if (this.glueQuietFrames >= GLUE_SETTLE_QUIET_FRAMES || capElapsed) {
      this.glueActive = false;
      return;
    }
    this.glueHandle = this.raf(this.glueTick);
  };

  /**
   * The user reclaimed the frame (a synchronous pause listener fired inside the
   * input event's call stack). Kill any pending single-shot frame and the
   * forced-glue window so no queued snap can fight the user's scroll.
   */
  cancel(): void {
    if (this.frameHandle != null) {
      this.caf(this.frameHandle);
    }
    this.framePending = false;
    this.frameHandle = null;
    if (this.glueHandle != null) {
      this.caf(this.glueHandle);
    }
    this.glueActive = false;
    this.glueHandle = null;
  }

  /** Whether a forced-glue window is currently running (for tests/diagnostics). */
  get isGluing(): boolean {
    return this.glueActive;
  }

  /** Cancel everything (unmount / session reset). */
  dispose(): void {
    this.cancel();
    this.writer = null;
  }
}
