export type NavigationCloseChildStatus = "running" | "completed" | "closed";

export interface NavigationCloseTranscriptEntry {
  speaker: "user" | "agent" | "tool";
  text: string;
}

export interface NavigationCloseChildAgent {
  id: string;
  title: string;
  status: NavigationCloseChildStatus;
  /** Seconds the child had already been running when the scenario loaded. */
  startedOffsetSec: number;
  stepIndex: number;
  stepCount: number;
  completionSummary?: string;
  closedNote?: string;
  /** Local command metadata, never a lifecycle state. */
  endRequested?: boolean;
  transcript: NavigationCloseTranscriptEntry[];
}

export interface NavigationCloseScenario {
  id: string;
  label: string;
  parentTitle: string;
  parentTranscript: NavigationCloseTranscriptEntry[];
  children: NavigationCloseChildAgent[];
}

export function buildNavigationCloseScenarios(): NavigationCloseScenario[] {
  return [
    {
      id: "mid-flight",
      label: "Mid-flight refactor",
      parentTitle: "Refactor payment retry pipeline",
      parentTranscript: [
        { speaker: "user", text: "Refactor the payment retry pipeline so retries are idempotent and observable." },
        { speaker: "agent", text: "I split this into four tracks and delegated three of them. I'm coordinating and reviewing results here." },
        { speaker: "tool", text: "Delegated: Migrate retry schema · Backfill retry metrics · Update retry integration tests" },
        { speaker: "agent", text: "Schema migration finished — see the Done section. The metrics backfill and test update are still running." },
      ],
      children: [
        {
          id: "nav-close/backfill-retry-metrics",
          title: "Backfill retry metrics",
          status: "running",
          startedOffsetSec: 252,
          stepIndex: 3,
          stepCount: 5,
          transcript: [
            { speaker: "agent", text: "Scanning the last 30 days of retry events to reconstruct metric points." },
            { speaker: "tool", text: "query events --topic payment.retry --since 30d → 48,112 rows" },
            { speaker: "agent", text: "Writing backfill batches. Two of five partitions are committed so far." },
          ],
        },
        {
          id: "nav-close/update-retry-tests",
          title: "Update retry integration tests",
          status: "running",
          startedOffsetSec: 98,
          stepIndex: 1,
          stepCount: 4,
          transcript: [
            { speaker: "agent", text: "Reading the existing retry integration suite to map which cases assume at-most-once delivery." },
            { speaker: "tool", text: "read tests/payments/retry_integration.spec.ts (612 lines)" },
          ],
        },
        {
          id: "nav-close/migrate-retry-schema",
          title: "Migrate retry schema",
          status: "completed",
          startedOffsetSec: 1240,
          stepIndex: 6,
          stepCount: 6,
          completionSummary: "Added idempotency_key column, backfilled 3 tables, migration applied cleanly",
          transcript: [
            { speaker: "agent", text: "Adding an idempotency_key column to retry_attempts and the two audit tables." },
            { speaker: "tool", text: "migrate apply 20260711_retry_idempotency → OK (3 tables)" },
            { speaker: "agent", text: "Done. Migration applied cleanly; backfill verified against a sampled 1% of rows." },
          ],
        },
        {
          id: "nav-close/spike-retry-dlq",
          title: "Spike: dead-letter queue sizing",
          status: "closed",
          startedOffsetSec: 2900,
          stepIndex: 2,
          stepCount: 5,
          closedNote: "Closed after finishing its turn — spike superseded by the metrics backfill",
          transcript: [
            { speaker: "agent", text: "Estimating DLQ volume under the proposed retry caps." },
            { speaker: "tool", text: "Closed by you. The agent finished its in-progress turn, then stopped." },
          ],
        },
      ],
    },
    {
      id: "fresh",
      label: "Fresh delegation",
      parentTitle: "Add CSV export to reports",
      parentTranscript: [
        { speaker: "user", text: "Add CSV export to the reports page." },
        { speaker: "agent", text: "I delegated the serializer work and will wire the UI here once it lands." },
      ],
      children: [
        {
          id: "nav-close/report-csv-serializer",
          title: "Build report CSV serializer",
          status: "running",
          startedOffsetSec: 14,
          stepIndex: 1,
          stepCount: 3,
          transcript: [
            { speaker: "agent", text: "Starting on the serializer. Reading the report row model first." },
          ],
        },
      ],
    },
    {
      id: "wrap-up",
      label: "Wrap-up review",
      parentTitle: "Harden auth session handling",
      parentTranscript: [
        { speaker: "user", text: "Harden session handling: rotation, revocation, and audit coverage." },
        { speaker: "agent", text: "All delegated tracks have finished. Review each result below, then delete the ones you've accepted." },
      ],
      children: [
        {
          id: "nav-close/session-rotation",
          title: "Implement session key rotation",
          status: "completed",
          startedOffsetSec: 3600,
          stepIndex: 5,
          stepCount: 5,
          completionSummary: "Rotation on privilege change + 24h schedule, 9 files changed",
          transcript: [
            { speaker: "agent", text: "Rotation triggers on privilege change and on a 24-hour schedule." },
            { speaker: "tool", text: "9 files changed · tests passing" },
          ],
        },
        {
          id: "nav-close/revocation-endpoint",
          title: "Add bulk revocation endpoint",
          status: "completed",
          startedOffsetSec: 3400,
          stepIndex: 4,
          stepCount: 4,
          completionSummary: "POST /sessions/revoke with per-user and global scopes",
          transcript: [
            { speaker: "agent", text: "Endpoint supports per-user and global revocation with an audit event per batch." },
          ],
        },
        {
          id: "nav-close/audit-log-events",
          title: "Emit session audit events",
          status: "completed",
          startedOffsetSec: 2100,
          stepIndex: 3,
          stepCount: 3,
          completionSummary: "Create/refresh/revoke events wired to the audit sink",
          transcript: [
            { speaker: "agent", text: "All three lifecycle events now flow to the audit sink with actor attribution." },
          ],
        },
        {
          id: "nav-close/legacy-cookie-spike",
          title: "Spike: legacy cookie migration",
          status: "closed",
          startedOffsetSec: 5000,
          stepIndex: 1,
          stepCount: 4,
          closedNote: "Closed after finishing its turn — legacy path is being removed instead",
          transcript: [
            { speaker: "agent", text: "Mapping which clients still send the legacy cookie." },
            { speaker: "tool", text: "Closed by you. The agent finished its in-progress turn, then stopped." },
          ],
        },
      ],
    },
  ];
}

function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
}

export function navigationCloseChildStatusLine(
  child: NavigationCloseChildAgent,
  elapsedSec: number,
): string {
  switch (child.status) {
    case "running":
      return child.endRequested
        ? "Working · end requested"
        : `Working · ${formatElapsed(elapsedSec)} · step ${child.stepIndex} of ${child.stepCount}`;
    case "completed":
      return `Done in ${formatElapsed(child.startedOffsetSec)} · ${child.completionSummary ?? ""}`;
    case "closed":
      return child.closedNote ?? "Closed";
  }
}
