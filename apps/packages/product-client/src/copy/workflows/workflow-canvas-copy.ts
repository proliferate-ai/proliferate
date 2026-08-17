/**
 * Authored strings for the workflows canvas (the pannable graph surface the
 * run view and the builder both draw their chains on). Copy only — geometry
 * lives in `domain/workflows/graph-layout.ts`, panning/zooming in
 * `WorkflowCanvas.tsx`.
 */
export const WORKFLOW_CANVAS_COPY = {
  zoomInLabel: "Zoom in",
  zoomOutLabel: "Zoom out",
  zoomFitLabel: "Fit to view",
  /** The builder toolbar's visible Fit text. */
  fitLabel: "Fit",
  /** "85%" — the zoom readout between the two buttons. */
  zoomLevel: (zoom: number): string => `${Math.round(zoom * 100)}%`,
} as const;
