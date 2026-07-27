import type { ModelSnapshotLiveState, ModelSnapshotStatus } from "@anyharness/sdk";
import {
  type HarnessCatalogModel,
  normalizeCatalogModels,
} from "#product/lib/domain/settings/harness-catalog";

/**
 * The composed machine observation as the All Models surface renders it
 * (model-catalog.md "The picker is the observation"): ONE observation per
 * harness — the model/mode lists off the same document read, the `probedAt`
 * age, and the `lastAttempt` outcome as a failed-refresh indicator. There is
 * no staleness computation here on purpose: freshness is event-driven and age
 * never disqualifies an observation, so the only freshness display is the age
 * string and the last-attempt outcome. The provenance fields (attestation,
 * install identity) are diagnostics-only — never gates.
 */
export interface ComposedModelObservation {
  /** The probe engine's live state (`idle` | `queued` | `running` | `backoff`). */
  engineState: ModelSnapshotLiveState;
  /** Timestamp of the last successful observation; `null` before the first one. */
  probedAt: string | null;
  /** Server-computed age of the observation, when known. */
  ageSeconds: number | null;
  /** The observation's model list, normalized for the model table. */
  models: HarnessCatalogModel[];
  /** The observation's harness-level mode labels. */
  modes: string[];
  /** `lastAttempt.outcome === "failed"` — the failed-refresh indicator. */
  lastAttemptFailed: boolean;
  /** The failed attempt's detail, lifted server-side; `null` otherwise. */
  lastError: string | null;
  /** Diagnostics-only provenance line (attestation + install identity). */
  provenance: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// Observation models carry the harness's own vocabulary (`name`, verbatim
// `provider`); alias `name` onto the table's `displayName` and reuse the
// loose-JSON catalog normalizer so probe-only entries render sparse rather
// than breaking (id-shaped label, no curation metadata).
function normalizeObservationModels(
  models: readonly Record<string, unknown>[] | undefined,
): HarnessCatalogModel[] {
  return normalizeCatalogModels(
    (models ?? []).map((entry) => ({ displayName: entry.name, ...entry })),
  );
}

function normalizeObservationModes(
  modes: readonly Record<string, unknown>[] | undefined,
): string[] {
  const labels: string[] = [];
  for (const entry of modes ?? []) {
    const label = asString(entry.name) ?? asString(entry.id);
    if (label) {
      labels.push(label);
    }
  }
  return labels;
}

// "codex 0.3.112 · install 1.18.3 (pinned_archive)" — a human debugging "why
// does the picker show X" lines the observation up against the install
// manifest. Nothing computes freshness from these fields.
function formatObservationProvenance(status: ModelSnapshotStatus): string | null {
  const parts: string[] = [];
  const attestation = asRecord(status.attestation);
  if (attestation) {
    const name = asString(attestation.name);
    const version = asString(attestation.version);
    const line = [name, version].filter((part) => part != null).join(" ");
    if (line) {
      parts.push(line);
    }
  }
  const install = asRecord(status.installIdentity);
  if (install) {
    const version = asString(install.version);
    const source = asString(install.source);
    if (version) {
      parts.push(`install ${version}${source ? ` (${source})` : ""}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Pure projection of the polled status document
 * (`GET /v1/agents/{kind}/model-snapshot`) onto what the All Models surface
 * renders. `null` only while no status has loaded at all.
 */
export function resolveComposedObservation(
  status: ModelSnapshotStatus | undefined,
): ComposedModelObservation | null {
  if (!status) {
    return null;
  }
  const lastAttempt = asRecord(status.lastAttempt);
  return {
    engineState: status.state,
    probedAt: status.probedAt ?? null,
    ageSeconds: typeof status.snapshotAgeSeconds === "number"
      ? status.snapshotAgeSeconds
      : null,
    models: normalizeObservationModels(
      status.models as readonly Record<string, unknown>[] | undefined,
    ),
    modes: normalizeObservationModes(
      status.modes as readonly Record<string, unknown>[] | undefined,
    ),
    lastAttemptFailed: lastAttempt?.outcome === "failed",
    lastError: asString(status.lastError),
    provenance: formatObservationProvenance(status),
  };
}

/**
 * Short duration label for a snapshot age ("5m", "2h", "3d") — no trailing
 * "ago", callers append it. `"just now"` is the one exception: it already
 * reads complete on its own, so `HARNESS_PANE_COPY.allModelsFreshRefreshedAgo`
 * must NOT glue its own "ago" onto this value (that produced "refreshed just
 * now ago" — see its call site).
 */
export function formatSnapshotAge(ageSeconds: number): string {
  const seconds = Math.max(0, Math.floor(ageSeconds));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
