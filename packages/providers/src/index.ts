/**
 * @proliferate/providers — Provider interfaces and types for the vNext architecture.
 */

export * from "./types";
export * from "./action-source";

// Provider implementations
export { linearSource } from "./providers/linear";
export { sentrySource } from "./providers/sentry";
export { slackSource } from "./providers/slack";
