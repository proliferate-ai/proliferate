import type { WakeCyclePhase } from "./types";
import { PHASE_TIMEOUT_MS } from "./types";

export class PhaseTimeoutError extends Error {
	readonly phase: WakeCyclePhase;

	constructor(phase: WakeCyclePhase) {
		super(`Phase ${phase} timed out after ${PHASE_TIMEOUT_MS[phase]}ms`);
		this.phase = phase;
	}
}

export class BudgetExhaustedError extends Error {}
