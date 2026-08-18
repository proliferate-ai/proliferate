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
import { IconButton } from "#product/primitives/IconButton";
import { Minus, Plus } from "#product/primitives/icons/core";
import { ExpandAll } from "#product/primitives/icons/workspace";

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.15;
/** Content padding inside the viewport when fitting, and the initial offset. */
const FIT_PADDING = 24;
/** Bottom controls/readout stay outside the fitted content band. */
const FIT_OVERLAY_SAFE_BAND = 48;
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
  /** Optional readout pinned to the bottom-left corner (validity, counts). */
  statusSlot?: ReactNode;
  /** Ends a feature-owned gesture when the pointer/keyboard leaves it unfinished. */
  onCancelInteraction?: () => void;
  className?: string;
}

/**
 * The pannable, zoomable dotted-grid surface both workflow graphs draw on:
 * drag the background to pan, ⌘/Ctrl+wheel or the corner controls to zoom,
 * Fit to frame the whole graph. Edges render in one SVG under the cards so a
 * card always covers the wire that enters it.
 *
 * The grid is painted on the viewport (not the transformed content) with its
 * pitch and phase driven by the same zoom/pan values, so it scrolls with the
 * content without the transform blurring 1px dots.
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
  statusSlot,
  onCancelInteraction,
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
      (bounds.height - FIT_PADDING * 2 - FIT_OVERLAY_SAFE_BAND) / contentHeight,
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

  const zoomBy = (delta: number, anchor?: { x: number; y: number }) => {
    touchedRef.current = true;
    setZoom((current) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta));
      const container = containerRef.current;
      const point = anchor ?? (container
        ? { x: container.clientWidth / 2, y: container.clientHeight / 2 }
        : { x: 0, y: 0 });
      if (next !== current) {
        setPan((currentPan) => ({
          x: point.x - (point.x - currentPan.x) * (next / current),
          y: point.y - (point.y - currentPan.y) * (next / current),
        }));
      }
      return next;
    });
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
    onCancelInteraction?.();
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // ⌘/Ctrl+wheel zooms (the design's gesture); a plain wheel is left alone
    // so the surrounding page keeps its scroll behavior.
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={`relative min-h-0 overflow-hidden rounded-lg border border-border ${dragRef.current ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      style={{
        backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
        backgroundSize: `${GRID_PITCH * zoom}px ${GRID_PITCH * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={() => onCancelInteraction?.()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancelInteraction?.();
        }
      }}
      onWheel={onWheel}
    >
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
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-border-heavy)" />
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
        <div className="absolute bottom-2 left-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 shadow-subtle">
          {statusSlot}
        </div>
      ) : null}

      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated px-1 py-0.5 shadow-subtle">
        <IconButton
          size="sm"
          aria-label={WORKFLOW_CANVAS_COPY.zoomOutLabel}
          title={WORKFLOW_CANVAS_COPY.zoomOutLabel}
          onClick={() => zoomBy(-ZOOM_STEP)}
        >
          <Minus className="icon-compact" aria-hidden />
        </IconButton>
        <span className="min-w-9 text-center font-mono text-ui-sm text-muted-foreground">
          {WORKFLOW_CANVAS_COPY.zoomLevel(zoom)}
        </span>
        <IconButton
          size="sm"
          aria-label={WORKFLOW_CANVAS_COPY.zoomInLabel}
          title={WORKFLOW_CANVAS_COPY.zoomInLabel}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus className="icon-compact" aria-hidden />
        </IconButton>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          size="sm"
          aria-label={WORKFLOW_CANVAS_COPY.zoomFitLabel}
          title={WORKFLOW_CANVAS_COPY.zoomFitLabel}
          onClick={() => {
            touchedRef.current = false;
            fit();
          }}
        >
          <ExpandAll className="icon-compact" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
