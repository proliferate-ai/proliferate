import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { WorkflowGraphEdgeLayout } from "#product/domain/workflows/graph-layout";
import { WORKFLOW_CANVAS_COPY } from "#product/copy/workflows/workflow-canvas-copy";
import { ExpandAll } from "#product/primitives/icons/workspace";
import { MiniPlus, Minus } from "#product/primitives/icons/core";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.8;
/** Multiplicative zoom steps, the design's wheel/button factors. */
const ZOOM_IN_FACTOR = 1.15;
const ZOOM_OUT_FACTOR = 0.87;
const FIT_PADDING = 24;
/** The design's dot-grid pitch at zoom 1. */
const GRID_PITCH = 22;

export interface WorkflowCanvasProps {
  /** Content extents in unscaled coordinates (`graph-layout.ts` units). */
  contentWidth: number;
  contentHeight: number;
  edges: readonly WorkflowGraphEdgeLayout[];
  /** Absolutely-positioned node cards, in the same content coordinates. */
  children: ReactNode;
  ariaLabel: string;
  /**
   * Which corner chrome the design gives this canvas: the builder's bordered
   * panel toolbar bottom-right (with − / + as text glyphs and a text "Fit"),
   * or the run view's glass icon toolbar bottom-left.
   */
  zoomChrome: "builder" | "run";
  /** The builder's bottom-left status pill (step counts, validity). */
  statusSlot?: ReactNode;
  className?: string;
}

/**
 * The pannable, zoomable dotted-grid surface both workflow graphs draw on —
 * a direct port of the design's canvas: 22px dot grid at half opacity phased
 * to the pan, multiplicative zoom (×1.15/×0.87, clamped 0.3–1.8) on
 * ⌘/Ctrl+wheel or the corner controls, Fit to frame the whole graph. Edges
 * render in one SVG under the cards with the design's 6px arrowhead.
 *
 * Decorative geometry only: the SVG is `aria-hidden`, and every node card is
 * a real button the caller provides, so the graph reads to a screen reader as
 * the list of its nodes.
 */
export function WorkflowCanvas({
  contentWidth,
  contentHeight,
  edges,
  children,
  ariaLabel,
  zoomChrome,
  statusSlot,
  className = "",
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: FIT_PADDING, y: FIT_PADDING });
  /** Once the user pans or zooms, content changes stop re-framing the view. */
  const touchedRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container || contentWidth <= 0 || contentHeight <= 0) {
      return;
    }
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const scale = Math.min(
      (bounds.width - FIT_PADDING * 2) / contentWidth,
      (bounds.height - FIT_PADDING * 2) / contentHeight,
      1,
    );
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
    setZoom(clamped);
    setPan({
      x: Math.max(FIT_PADDING, (bounds.width - contentWidth * clamped) / 2),
      y: FIT_PADDING,
    });
  }, [contentHeight, contentWidth]);

  // Frame the graph on mount and keep re-framing as it grows — until the user
  // takes the viewport over, after which their framing wins.
  useEffect(() => {
    if (!touchedRef.current) {
      fit();
    }
  }, [fit]);

  const zoomBy = (factor: number) => {
    touchedRef.current = true;
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only the background pans; a press on a node card or a zoom control —
    // every interactive thing on this surface is a button — belongs to it.
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    touchedRef.current = true;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setPan({
      x: drag.panX + (event.clientX - drag.startX),
      y: drag.panY + (event.clientY - drag.startY),
    });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // ⌘/Ctrl+wheel zooms (the design's gesture); a plain wheel is left alone
    // so the surrounding page keeps its scroll behavior.
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR);
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={`relative min-h-0 overflow-hidden ${dragRef.current ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.5,
          backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: `${GRID_PITCH * zoom}px ${GRID_PITCH * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div
        className="absolute left-0 top-0"
        style={{
          width: contentWidth,
          height: contentHeight,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={Math.max(contentWidth, 1)}
          height={Math.max(contentHeight, 1)}
        >
          <defs>
            <marker
              id="workflow-canvas-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--color-border-heavy)" />
            </marker>
          </defs>
          {edges.map((edge) => (
            <path
              key={`${edge.fromKey}->${edge.toKey}`}
              d={edge.path}
              fill="none"
              stroke="var(--color-border-heavy)"
              strokeWidth={1.5}
              strokeDasharray={edge.kind === "branch" ? "4 4" : undefined}
              markerEnd="url(#workflow-canvas-arrow)"
            />
          ))}
        </svg>
        {children}
      </div>

      {statusSlot ? (
        <div
          className="absolute flex flex-col items-start"
          style={{
            left: 12,
            bottom: 12,
            width: 264,
            minWidth: 172,
            maxWidth: "calc(100% - 156px)",
            gap: 3,
            padding: "6px 9px",
            borderRadius: 9,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-elevated)",
          }}
        >
          {statusSlot}
        </div>
      ) : null}

      {zoomChrome === "builder" ? (
        <div
          className="absolute flex items-center"
          style={{
            right: 12,
            bottom: 12,
            gap: 2,
            padding: 3,
            borderRadius: 9,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-elevated)",
          }}
        >
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomOutLabel}
            title={WORKFLOW_CANVAS_COPY.zoomOutLabel}
            className="text-ui grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ width: 24, height: 24, font: "inherit" }}
            onClick={() => zoomBy(ZOOM_OUT_FACTOR)}
          >
            −
          </button>
          <span className="text-ui-sm text-center font-mono text-faint" style={{ minWidth: 38 }}>
            {WORKFLOW_CANVAS_COPY.zoomLevel(zoom)}
          </span>
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomInLabel}
            title={WORKFLOW_CANVAS_COPY.zoomInLabel}
            className="text-ui grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ width: 24, height: 24, font: "inherit" }}
            onClick={() => zoomBy(ZOOM_IN_FACTOR)}
          >
            +
          </button>
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomFitLabel}
            title={WORKFLOW_CANVAS_COPY.zoomFitLabel}
            className="text-ui-sm cursor-pointer rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ height: 24, padding: "0 8px", font: "inherit" }}
            onClick={() => {
              touchedRef.current = false;
              fit();
            }}
          >
            {WORKFLOW_CANVAS_COPY.fitLabel}
          </button>
        </div>
      ) : (
        <div
          className="absolute flex items-center backdrop-blur-sm"
          style={{
            left: 12,
            bottom: 12,
            gap: 2,
            padding: 3,
            borderRadius: 10,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-control)",
          }}
        >
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomOutLabel}
            title={WORKFLOW_CANVAS_COPY.zoomOutLabel}
            className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ width: 26, height: 26 }}
            onClick={() => zoomBy(ZOOM_OUT_FACTOR)}
          >
            <Minus className="icon-tight" aria-hidden />
          </button>
          <span
            className="text-ui-sm text-center font-mono text-muted-foreground"
            style={{ minWidth: 44 }}
          >
            {WORKFLOW_CANVAS_COPY.zoomLevel(zoom)}
          </span>
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomInLabel}
            title={WORKFLOW_CANVAS_COPY.zoomInLabel}
            className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ width: 26, height: 26 }}
            onClick={() => zoomBy(ZOOM_IN_FACTOR)}
          >
            <MiniPlus className="icon-tight" aria-hidden />
          </button>
          <div aria-hidden className="bg-border" style={{ width: 1, height: 16, margin: "0 2px" }} />
          <button
            type="button"
            aria-label={WORKFLOW_CANVAS_COPY.zoomFitLabel}
            title={WORKFLOW_CANVAS_COPY.zoomFitLabel}
            className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            style={{ width: 26, height: 26 }}
            onClick={() => {
              touchedRef.current = false;
              fit();
            }}
          >
            <ExpandAll className="icon-tight" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
