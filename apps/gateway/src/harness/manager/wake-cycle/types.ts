/**
 * Manager harness wake-cycle types.
 */

export const WAKE_CYCLE_PHASES = ["ingest", "triage", "orchestrate", "finalize"] as const;
export type WakeCyclePhase = (typeof WAKE_CYCLE_PHASES)[number];

export const TRIAGE_DECISIONS = ["act", "skip", "escalate"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

export const WAKE_CYCLE_OUTCOMES = [
	"completed",
	"skipped",
	"escalated",
	"failed",
	"budget_exhausted",
	"timed_out",
] as const;
export type WakeCycleOutcome = (typeof WAKE_CYCLE_OUTCOMES)[number];

export const PHASE_TIMEOUT_MS: Record<WakeCyclePhase, number> = {
	ingest: 30_000,
	triage: 60_000,
	orchestrate: 600_000,
	finalize: 30_000,
};

export interface RunContext {
	workerRunId: string;
	workerId: string;
	organizationId: string;
	managerSessionId: string;
	wakeEventId: string;
	wakeSource: string;
	wakePayload: unknown;
	workerObjective: string | null;
	workerName: string;
}

export interface WakeCycleResult {
	outcome: WakeCycleOutcome;
	summary: string | null;
	triageDecision: TriageDecision | null;
	childSessionIds: string[];
	phasesCompleted: WakeCyclePhase[];
	error?: { code: string; message: string };
}

export interface ManagerToolContext {
	managerSessionId: string;
	organizationId: string;
	workerId: string;
	workerRunId: string;
	gatewayUrl: string;
	serviceToken: string;
}
