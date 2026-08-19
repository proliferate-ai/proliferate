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
  /**
   * PRO-168 (rung 12, Q16): true while the pluggable motion writer (the eased
   * follow policy) has written a step that has not yet reached its target.
   * Absent, or false, for the default instant writer. When true after a pass,
   * the pipeline schedules exactly one more frame purely to let that same
   * writer keep converging — still this one pipeline's own scheduling, never
   * a second competing rAF loop (FR-1).
   */
  hasPendingMotion?: () => boolean;
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

  // Per-frame coalescing guard for the synchronous single-shot snap. The content
  // ResizeObserver fires AFTER layout and BEFORE paint, so the growth it reports
  // is already committed and measurable: the snap runs synchronously inside that
  // notify (see `requestFrame`), never deferred to the next frame. This flag is
  // set for the remainder of the current frame so a second same-frame notify
  // folds into the pass that already ran; a guard-reset rAF clears it so the
  // NEXT frame's first notify runs a fresh pass. `frameHandle` is only that
  // guard-reset frame (it runs no snap), retained so `cancel`/`beginGlue` can
  // drop it.
  private framePassRanThisFrame = false;
  private frameHandle: number | null = null;
  // Content height the last pass in THIS frame snapped against. A second notify
  // in the same frame re-runs the pass ONLY when the measured height has grown
  // past this — a real later estimate-to-measured correction the single snap
  // must still absorb — never for the snap's own echo (a scrollTop write changes
  // no observed size, so a re-run can never loop). See `requestFrame`.
  private framePassHeight = -1;
  // The self-driving forced-glue window (session entry / submit / tab resume).
  // `glueActive` is likewise the source of truth for the same reentrancy reason.
  private glueActive = false;
  private glueHandle: number | null = null;
  private glueStartedAt = 0;
  private glueLastHeight = -1;
  private glueQuietFrames = 0;
  // Ensures delivered during a running pass are owed one coalesced trailing
  // pass; requests already present when a pass starts are satisfied by it.
  private glueDemandGeneration = 0;
  private glueServedGeneration = 0;
  // PRO-168 (rung 12): the motion writer's own continuation handle, separate
  // from frameHandle/glueHandle so it never contends with either's guard
  // bookkeeping. Only ever armed when the writer reports pending motion.
  private motionHandle: number | null = null;

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
   * The content ResizeObserver (the sole in-layout mutation source) requests the
   * one frame pass. It runs SYNCHRONOUSLY: RO callbacks fire after the browser
   * has committed the frame's layout and before paint, so the grown height is
   * already measurable and the snap belongs in THIS frame's layout phase.
   * Deferring it to the next rAF is the pinned-follow drift — under continuous
   * growth the viewport would trail one frame behind a taller document forever.
   *
   * Coalesces: the first notify in a frame runs `runFramePass` exactly once and
   * arms a per-frame guard; a later notify in the same frame folds into that
   * pass UNLESS the content has grown further since it ran — a real later
   * estimate-to-measured correction (React commit then virtualizer re-measure
   * land as separate same-frame notifies, and the taller one can arrive second),
   * which re-runs the pass so the snap tracks the FINAL height instead of
   * trailing one growth step behind. Re-running on strict growth can never loop:
   * the pass only writes scrollTop, which changes no observed size. A guard-reset
   * rAF (the ONLY rAF here, reserved for crossing into the next frame) clears the
   * guard so the next frame's first notify snaps afresh. A no-op while a
   * forced-glue window is already snapping every frame.
   */
  requestFrame(): void {
    if (this.glueActive) {
      return;
    }
    const writer = this.writer;
    if (writer == null) {
      return;
    }
    if (this.framePassRanThisFrame && writer.measureContentHeight() <= this.framePassHeight) {
      return;
    }
    // Arm the guard BEFORE running the pass so a reentrant notify (a snap write
    // that itself trips the RO) folds in rather than snapping twice.
    this.framePassRanThisFrame = true;
    if (this.frameHandle == null) {
      this.frameHandle = this.raf(() => {
        this.framePassRanThisFrame = false;
        this.frameHandle = null;
        this.framePassHeight = -1;
      });
    }
    writer.runFramePass();
    // Record the height the snap just settled against so a later same-frame
    // notify re-runs only on further growth (a scrollTop write leaves it equal).
    this.framePassHeight = writer.measureContentHeight();
    // PRO-168 (rung 12): the instant writer never reports pending motion, so
    // this is a no-op for v1. An eased writer still mid-step keeps this
    // pipeline (and only this pipeline) ticking until it converges.
    this.continueMotionIfPending();
  }

  /**
   * PRO-168 (rung 12): while the writer's motion policy has not yet converged
   * (`hasPendingMotion` true), keep scheduling exactly one frame at a time so
   * the SAME writer can finish its catch-up — a self-perpetuating chain owned
   * by this pipeline, not a second animator. Idempotent: a handle already
   * armed is left alone.
   */
  private continueMotionIfPending(): void {
    const writer = this.writer;
    if (writer?.hasPendingMotion?.() !== true) {
      return;
    }
    if (this.motionHandle != null) {
      return;
    }
    this.motionHandle = this.raf(() => {
      this.motionHandle = null;
      const current = this.writer;
      // Re-check pending AT FIRE TIME, not just when this frame was armed: the
      // pass that ran since (glue, or an earlier motion tick) may have already
      // converged the writer, and re-running would waste a frame on a motion
      // step nobody needs. Mirrors glueTick's shouldContinueGlue gate, checked
      // before running rather than only after.
      if (current == null || current.hasPendingMotion?.() !== true) {
        return;
      }
      current.runFramePass();
      this.continueMotionIfPending();
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
    // Fold any pending motion continuation into the glue window: the glue
    // loop below runs every frame regardless, so a separately-scheduled
    // motion tick would double the same writer's pass in one frame.
    if (this.motionHandle != null) {
      this.caf(this.motionHandle);
      this.motionHandle = null;
    }
    // Fold the pending guard-reset frame into the window and re-arm from scratch.
    if (this.frameHandle != null) {
      this.caf(this.frameHandle);
    }
    this.framePassRanThisFrame = false;
    this.frameHandle = null;
    this.framePassHeight = -1;
    if (this.glueHandle != null) {
      this.caf(this.glueHandle);
    }
    this.glueActive = true;
    this.glueStartedAt = this.now();
    this.glueLastHeight = -1;
    this.glueQuietFrames = 0;
    this.glueServedGeneration = this.glueDemandGeneration;
    this.glueHandle = this.raf(this.glueTick);
  }

  /** Preserve an active glue window, or start one when no window is scheduled. */
  ensureGlue(): void {
    if (this.glueActive) {
      this.glueDemandGeneration += 1;
      return;
    }
    this.beginGlue();
  }

  private glueTick = (): void => {
    const writer = this.writer;
    if (writer == null || !writer.shouldContinueGlue()) {
      this.glueActive = false;
      // PRO-168 (rung 12): the glue window ending mid-motion (the user
      // reclaimed control, or the viewport vanished) still hands off to the
      // motion continuation below when the writer itself still has motion
      // pending; when the writer is gone that check is a safe no-op.
      this.continueMotionIfPending();
      return;
    }
    const passGeneration = this.glueDemandGeneration;
    writer.runFramePass();
    this.glueServedGeneration = passGeneration;

    const height = writer.measureContentHeight();
    if (height === this.glueLastHeight) {
      this.glueQuietFrames += 1;
    } else {
      this.glueQuietFrames = 0;
      this.glueLastHeight = height;
    }

    const capElapsed = this.now() - this.glueStartedAt >= TRANSCRIPT_GLUE_MAX_MS;
    const trailingEnsurePending = this.glueServedGeneration !== this.glueDemandGeneration;
    if (
      (this.glueQuietFrames >= GLUE_SETTLE_QUIET_FRAMES || capElapsed)
      && !trailingEnsurePending
    ) {
      this.glueActive = false;
      // PRO-168 (rung 12): the height-quiet/hard-cap glue terminator is about
      // CONTENT settling, not the motion writer's own catch-up distance — an
      // eased follower can still be short of its target on the very frame
      // glue stops (e.g. a burst that settles height quickly but leaves scroll
      // position trailing). Hand off to the motion continuation so it keeps
      // converging without turning glue's window into a second countdown for
      // the same thing.
      this.continueMotionIfPending();
      return;
    }
    this.glueHandle = this.raf(this.glueTick);
  };

  /**
   * The user reclaimed the frame (a synchronous pause listener fired inside the
   * input event's call stack). The single-shot snap is synchronous so nothing is
   * queued from it, but drop the per-frame guard-reset rAF and kill the
   * forced-glue window so no queued snap can fight the user's scroll.
   */
  cancel(): void {
    if (this.frameHandle != null) {
      this.caf(this.frameHandle);
    }
    this.framePassRanThisFrame = false;
    this.frameHandle = null;
    this.framePassHeight = -1;
    if (this.glueHandle != null) {
      this.caf(this.glueHandle);
    }
    this.glueActive = false;
    this.glueHandle = null;
    if (this.motionHandle != null) {
      this.caf(this.motionHandle);
    }
    this.motionHandle = null;
    this.glueServedGeneration = this.glueDemandGeneration;
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
