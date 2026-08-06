import { motion } from "@proliferate/design/motion";

export const STREAM_FLUSH_MS = 16;
export const STREAM_REVEAL_COMMIT_INTERVAL_MS = 32;
export const STREAM_REVEAL_IDLE_MS = 240;
export const STREAM_REVEAL_FADE_MS = motion.activity.streamRevealFadeMs;
export const STREAM_REVEAL_HANDOFF_DELAY_MS = motion.activity.streamRevealHandoffDelayMs;
export const STREAM_REVEAL_SETTLE_MS =
  STREAM_REVEAL_FADE_MS + STREAM_REVEAL_HANDOFF_DELAY_MS;
export const MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND = 360;
