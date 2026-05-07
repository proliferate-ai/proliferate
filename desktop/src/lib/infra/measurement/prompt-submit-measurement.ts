import type { MeasurementSurface } from "@/lib/infra/measurement/debug-measurement";

export const PROMPT_SUBMIT_MEASUREMENT_SURFACES = [
  "chat-composer",
  "chat-composer-dock",
  "chat-surface",
  "session-transcript-pane",
  "transcript-list",
  "header-tabs",
] as const satisfies readonly MeasurementSurface[];

export const PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS = 5_000;
