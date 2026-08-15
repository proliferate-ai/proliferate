import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion } from "@proliferate/design/motion";
import {
  diagnosticField,
  recordRendererDiagnostic,
  type RendererDiagnosticCorrelation,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

/**
 * The single loading-treatment gate (UX Latency + Transitions ADR §4.2, Rung 2,
 * FR-1 / Q1 / Q19). It owns the show-delay + min-display state machine so no call
 * site hand-rolls a CSS animation-delay or a flicker hold again.
 *
 * State is a discriminated `pending | empty | ready`, never a boolean, because
 * empty is a resolved outcome and must be distinguishable from still-waiting:
 *
 *   - While `pending`, nothing renders until the wait crosses
 *     `motion.loading.showDelayMs` (200ms, the Class C default window). Anything
 *     that resolves faster than that never mounts a treatment at all, so fast
 *     paths stay treatment-free.
 *   - Once the treatment has mounted it stays at least `motion.loading.minDisplayMs`
 *     (300ms) before yielding, for both `ready` and `empty` resolutions, so a
 *     treatment that only just appeared cannot flash back out.
 *   - `empty` may only render after data resolves. While `pending` the boundary
 *     shows the class treatment or nothing, never the empty slot.
 *   - The one sanctioned reveal is `content-fade-in` at `--duration-enter`
 *     (160ms); reduced motion disables the fade via CSS, so content appears
 *     instantly. No raw milliseconds are authored here.
 *
 * The treatment itself is a slot (`treatment`): Class A is the ProliferateLivingMark,
 * Class B is the Spinner, supplied by the call site. The boundary never picks or
 * renders two treatments inside one pending window.
 *
 * Observability: the boundary emits lightweight `renderer.loading.*` marks through
 * the same renderer diagnostics port as the Rung 1 `renderer.flow.*` family, so
 * both the suppressed-under-show-delay case and the min-display hold are visible
 * in telemetry and assertable in tests.
 */

export type LoadingBoundaryState = "pending" | "empty" | "ready";

type Phase = "waiting" | "treatment" | "resolved";

export interface LoadingBoundaryProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Discriminated load state. `empty`/`ready` are resolved outcomes. */
  state: LoadingBoundaryState;
  /** Class A/B treatment shown only inside a qualifying pending window. */
  treatment: ReactNode;
  /** Resolved, non-empty content. */
  children?: ReactNode;
  /** Resolved empty-state content. Only rendered after `state === "empty"`. */
  emptyContent?: ReactNode;
  /**
   * Show-delay override. Defaults to the Class C window; other ADR classes pass
   * their own token. Never a raw literal at the call site.
   */
  showDelayMs?: number;
  /** Min-display override. Defaults to `motion.loading.minDisplayMs`. */
  minDisplayMs?: number;
  /** Correlation + flow label for the `renderer.loading.*` diagnostic marks. */
  diagnostics?: {
    flow?: string;
    correlation?: RendererDiagnosticCorrelation;
  };
}

function nowMs(): number {
  return Date.now();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function LoadingBoundary({
  state,
  treatment,
  children,
  emptyContent,
  showDelayMs = motion.loading.showDelayMs,
  minDisplayMs = motion.loading.minDisplayMs,
  diagnostics,
  className,
  ...rest
}: LoadingBoundaryProps) {
  const [phase, setPhase] = useState<Phase>(
    state === "pending" ? "waiting" : "resolved",
  );
  const [prevState, setPrevState] = useState<LoadingBoundaryState>(state);
  const shownAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(nowMs());
  const contentRef = useRef<HTMLDivElement>(null);

  const flow = diagnostics?.flow;
  const correlation = diagnostics?.correlation ?? {};

  // Derived-state reset (React's "adjust state while rendering" pattern). A
  // single mounted instance is reused across many load cycles (Rung 3 routes
  // the persistent chat pane through here), so whenever `state` transitions
  // back into `pending` from any resolved outcome we re-arm a fresh `waiting`
  // cycle synchronously: clear the prior cycle's shown timestamp and restart
  // the elapsed clock. Timers from the previous cycle are torn down by the
  // effect cleanups below when `phase`/`state` change, so no min-display hold
  // or diagnostic from cycle N can bleed into cycle N+1.
  if (state !== prevState) {
    setPrevState(state);
    if (state === "pending" && prevState !== "pending") {
      shownAtRef.current = null;
      startedAtRef.current = nowMs();
      setPhase("waiting");
    }
  }

  // Show-delay: mount the treatment only if the wait outlives the window.
  useEffect(() => {
    if (state !== "pending" || phase !== "waiting") {
      return;
    }
    const timer = window.setTimeout(() => {
      shownAtRef.current = nowMs();
      recordRendererDiagnostic({
        name: "renderer.loading.treatment_shown",
        severity: "debug",
        kind: "progress",
        privacy: "operational",
        correlation,
        fields: {
          flow: diagnosticField(flow ?? "unnamed", "operational"),
          show_delay_ms: diagnosticField(showDelayMs, "operational"),
          min_display_ms: diagnosticField(minDisplayMs, "operational"),
        },
      });
      setPhase("treatment");
    }, showDelayMs);
    return () => window.clearTimeout(timer);
    // `correlation`/`flow` are diagnostic-only and stable per surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase, showDelayMs, minDisplayMs]);

  // Resolution: suppress a never-shown treatment, or hold a shown one for the
  // min-display floor, then reveal resolved content.
  useEffect(() => {
    if (state === "pending" || phase === "resolved") {
      return;
    }
    if (phase === "waiting") {
      recordRendererDiagnostic({
        name: "renderer.loading.treatment_suppressed",
        severity: "debug",
        kind: "progress",
        privacy: "operational",
        correlation,
        fields: {
          flow: diagnosticField(flow ?? "unnamed", "operational"),
          resolution: diagnosticField(state, "operational"),
          elapsed_ms: diagnosticField(round(nowMs() - startedAtRef.current), "operational"),
          show_delay_ms: diagnosticField(showDelayMs, "operational"),
        },
      });
      setPhase("resolved");
      return;
    }
    // phase === "treatment": honor the anti-flicker hold.
    const shownAt = shownAtRef.current ?? nowMs();
    const held = nowMs() - shownAt;
    const remaining = Math.max(0, minDisplayMs - held);
    const settle = () => {
      recordRendererDiagnostic({
        name: "renderer.loading.settled",
        severity: "debug",
        kind: "progress",
        privacy: "operational",
        correlation,
        fields: {
          flow: diagnosticField(flow ?? "unnamed", "operational"),
          resolution: diagnosticField(state, "operational"),
          held_ms: diagnosticField(round(nowMs() - shownAt), "operational"),
          min_display_ms: diagnosticField(minDisplayMs, "operational"),
        },
      });
      setPhase("resolved");
    };
    if (remaining === 0) {
      settle();
      return;
    }
    const timer = window.setTimeout(settle, remaining);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase, minDisplayMs, showDelayMs]);

  // Restart the one sanctioned reveal (`content-fade-in`) once per visible
  // phase without remounting the wrapper. A key that flips treatment/content
  // would remount the resolved subtree on every reveal and destroy the live
  // children's scroll/focus/component state (Rung 3's chat pane). Instead the
  // wrapper stays mounted and we re-trigger the CSS animation with a reflow-safe
  // remove/reflow/add so child identity is preserved across the swap.
  useLayoutEffect(() => {
    if (phase === "waiting") {
      return;
    }
    const el = contentRef.current;
    if (!el) {
      return;
    }
    el.classList.remove("animate-content-fade-in");
    // Force a reflow so the browser treats the re-added class as a fresh run.
    void el.offsetWidth;
    el.classList.add("animate-content-fade-in");
  }, [phase]);

  if (phase === "waiting") {
    // Inside the show-delay window: nothing renders. A sub-show-delay resolution
    // reaches `resolved` without ever passing through `treatment`.
    return null;
  }

  const showTreatment = phase === "treatment";
  const slot = showTreatment
    ? treatment
    : state === "empty"
      ? emptyContent
      : children;

  return (
    <div ref={contentRef} className={className} {...rest}>
      {slot}
    </div>
  );
}
