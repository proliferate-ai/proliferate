/**
 * In-memory test doubles for the managed-cloud world unit tests: a candidate
 * manifest builder, a recording evidence sink, an in-memory cleanup ledger,
 * and a WorldContext factory. Test-only; not imported by production paths.
 */

import type { CandidateManifest, Slot, TemplateSlot } from "../../contracts/artifacts.js";
import type { CleanupEntry, CleanupLedger, CleanupState } from "../../contracts/cleanup.js";
import type { EvidenceSink, RunEvidence } from "../../contracts/evidence.js";
import type { RunIdentity, ShardIdentity } from "../../contracts/identity.js";
import type { WorldContext } from "../../contracts/world.js";

export function makeCandidateManifest(e2bTemplate: Slot<TemplateSlot>): CandidateManifest {
  const unavailable = { available: false as const, reason: "not built in unit test" };
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha: "0".repeat(40),
    sourceContentHash: "content-hash",
    serverImage: unavailable,
    webBuild: unavailable,
    desktopApp: unavailable,
    desktopUpdater: unavailable,
    anyharness: {},
    worker: {},
    supervisor: {},
    catalogHash: unavailable,
    registryHash: unavailable,
    e2bTemplate,
    selfHostBundle: unavailable,
    litellm: unavailable,
  };
}

export function recordingEvidenceSink(): { sink: EvidenceSink; events: Record<string, unknown>[]; finalized: RunEvidence[] } {
  const events: Record<string, unknown>[] = [];
  const finalized: RunEvidence[] = [];
  const sink: EvidenceSink = {
    append: async (event) => { events.push(event as Record<string, unknown>); },
    finalize: async (evidence) => { finalized.push(evidence); },
  };
  return { sink, events, finalized };
}

export function memLedger(): { ledger: CleanupLedger; rows: CleanupEntry[] } {
  const rows: CleanupEntry[] = [];
  let seq = 0;
  const ledger: CleanupLedger = {
    register: async (entry) => {
      seq += 1;
      const now = new Date().toISOString();
      rows.push({ ...entry, sequence: seq, state: "registered", attempts: 0, registeredAt: now, updatedAt: now, lastError: null });
      return seq;
    },
    transition: async (sequence: number, state: CleanupState, error?: string) => {
      const idx = rows.findIndex((r) => r.sequence === sequence);
      if (idx >= 0) rows[idx] = { ...rows[idx], state, updatedAt: new Date().toISOString(), lastError: error ?? rows[idx].lastError };
    },
    entries: async () => rows,
  };
  return { ledger, rows };
}

export function makeWorldContext(candidate: CandidateManifest): { ctx: WorldContext; events: Record<string, unknown>[] } {
  const run: RunIdentity = {
    runId: "run-test",
    sourceSha: "0".repeat(40),
    candidateManifestHash: "manifest-hash",
    retainedManifestHash: null,
    executionHost: "local",
    origin: "local:test",
    createdAt: new Date().toISOString(),
  };
  const shard: ShardIdentity = { runId: run.runId, shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };
  const { sink, events } = recordingEvidenceSink();
  const { ledger } = memLedger();
  const ctx: WorldContext = { run, shard, candidate, retained: null, ledger, evidence: sink };
  return { ctx, events };
}

/** A fetch double keyed by URL substring -> Response. */
export function fakeFetch(routes: Record<string, { status: number } | Error>): (url: string) => Promise<Response> {
  return async (url: string) => {
    for (const [needle, outcome] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (outcome instanceof Error) throw outcome;
        return new Response(null, { status: outcome.status });
      }
    }
    return new Response(null, { status: 404 });
  };
}
