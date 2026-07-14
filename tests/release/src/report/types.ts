/**
 * Structured failure report shape. Field names are snake_case on purpose:
 * this is the wire shape we expect to POST to the issues-service
 * `/v1/reports`-style endpoint later (see specs/tbd/issues-service-v1.md),
 * so the JSON on disk today should need no translation when that endpoint
 * exists. Keep all serialization logic in ./failure-reporter.ts — nothing
 * else should hand-construct this shape.
 */
export interface FailureReport {
  flow: string;
  scenario_id: string;
  lane: string;
  expected: string;
  observed: string;
  logs_excerpt: string;
  correlation_ids: string[];
  timestamp: string;
}

