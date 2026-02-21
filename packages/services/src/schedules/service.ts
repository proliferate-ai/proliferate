/**
 * Schedules service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Schedule } from "@proliferate/shared/contracts";
import type { CreateScheduleInput, UpdateScheduleInput } from "../types/schedules";
import * as schedulesDb from "./db";
import { toSchedule, toSchedules } from "./mapper";

// ============================================
// Validation helpers
// ============================================

/**
 * Validation error used for invalid cron expressions.
 */
export class CronValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CronValidationError";
	}
}

interface CronFieldSpec {
	min: number;
	max: number;
	allowQuestion?: boolean;
	aliases?: Readonly<Record<string, number>>;
}

const MONTH_ALIASES: Readonly<Record<string, number>> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12,
};

const DAY_OF_WEEK_ALIASES: Readonly<Record<string, number>> = {
	SUN: 0,
	MON: 1,
	TUE: 2,
	WED: 3,
	THU: 4,
	FRI: 5,
	SAT: 6,
};

const FIVE_FIELD_SPECS: ReadonlyArray<CronFieldSpec> = [
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31, allowQuestion: true },
	{ min: 1, max: 12, aliases: MONTH_ALIASES },
	{ min: 0, max: 7, allowQuestion: true, aliases: DAY_OF_WEEK_ALIASES },
];

const SIX_FIELD_SPECS: ReadonlyArray<CronFieldSpec> = [
	{ min: 0, max: 59 },
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31, allowQuestion: true },
	{ min: 1, max: 12, aliases: MONTH_ALIASES },
	{ min: 0, max: 7, allowQuestion: true, aliases: DAY_OF_WEEK_ALIASES },
];

const DIGITS_ONLY = /^\d+$/;

function parseCronValue(token: string, spec: CronFieldSpec): number | null {
	const normalized = token.toUpperCase();
	if (spec.aliases?.[normalized] !== undefined) {
		return spec.aliases[normalized];
	}
	if (!DIGITS_ONLY.test(token)) {
		return null;
	}
	const value = Number(token);
	if (!Number.isSafeInteger(value)) {
		return null;
	}
	return value >= spec.min && value <= spec.max ? value : null;
}

function validateBaseToken(token: string, spec: CronFieldSpec): boolean {
	if (token === "*") return true;
	if (spec.allowQuestion && token === "?") return true;

	const rangeParts = token.split("-");
	if (rangeParts.length === 2) {
		const [startRaw, endRaw] = rangeParts;
		if (!startRaw || !endRaw) return false;
		const start = parseCronValue(startRaw, spec);
		const end = parseCronValue(endRaw, spec);
		return start !== null && end !== null && start <= end;
	}

	if (rangeParts.length > 2) {
		return false;
	}

	return parseCronValue(token, spec) !== null;
}

function validateCronPart(part: string, spec: CronFieldSpec): boolean {
	if (part.length === 0) return false;

	const stepParts = part.split("/");
	if (stepParts.length === 2) {
		const [base, stepRaw] = stepParts;
		if (!base || !stepRaw || !DIGITS_ONLY.test(stepRaw)) return false;
		const step = Number(stepRaw);
		if (!Number.isSafeInteger(step) || step <= 0) return false;
		if (base === "?") return false;
		return validateBaseToken(base, spec);
	}

	if (stepParts.length > 2) {
		return false;
	}

	return validateBaseToken(part, spec);
}

function validateCronField(field: string, spec: CronFieldSpec): boolean {
	const parts = field.split(",");
	if (parts.length === 0) return false;

	for (const rawPart of parts) {
		const part = rawPart.trim();
		if (!validateCronPart(part, spec)) {
			return false;
		}
	}

	return true;
}

/**
 * Validate cron expression with strict token/range checks for 5- or 6-field formats.
 */
export function validateCronExpression(cronExpression: string): boolean {
	const cronParts = cronExpression.trim().split(/\s+/);
	const specs =
		cronParts.length === 5 ? FIVE_FIELD_SPECS : cronParts.length === 6 ? SIX_FIELD_SPECS : null;

	if (!specs) {
		return false;
	}

	return cronParts.every((field, index) => validateCronField(field, specs[index]));
}

export function assertValidCronExpression(
	cronExpression: string,
	message = "Invalid cron expression. Expected 5 or 6 fields.",
): void {
	if (!validateCronExpression(cronExpression)) {
		throw new CronValidationError(message);
	}
}

export function isCronValidationError(error: unknown): error is CronValidationError {
	return error instanceof CronValidationError;
}

// ============================================
// Service functions
// ============================================

/**
 * Get a schedule by ID.
 */
export async function getSchedule(id: string, orgId: string): Promise<Schedule | null> {
	const row = await schedulesDb.findById(id, orgId);
	if (!row) return null;
	return toSchedule(row);
}

/**
 * List schedules for an automation.
 */
export async function listSchedules(automationId: string): Promise<Schedule[]> {
	const rows = await schedulesDb.listByAutomation(automationId);
	return toSchedules(rows);
}

/**
 * Create a new schedule.
 */
export async function createSchedule(
	automationId: string,
	orgId: string,
	userId: string,
	input: CreateScheduleInput,
): Promise<Schedule> {
	assertValidCronExpression(input.cronExpression);

	const row = await schedulesDb.create({
		automationId,
		organizationId: orgId,
		name: input.name,
		cronExpression: input.cronExpression,
		timezone: input.timezone,
		enabled: input.enabled,
		createdBy: userId,
	});

	return toSchedule(row);
}

/**
 * Update a schedule.
 */
export async function updateSchedule(
	id: string,
	orgId: string,
	input: UpdateScheduleInput,
): Promise<Schedule> {
	// Validate cron expression if provided
	if (input.cronExpression) {
		assertValidCronExpression(input.cronExpression);
	}

	const row = await schedulesDb.update(id, orgId, {
		name: input.name,
		cronExpression: input.cronExpression,
		timezone: input.timezone,
		enabled: input.enabled,
	});

	return toSchedule(row);
}

/**
 * Delete a schedule.
 */
export async function deleteSchedule(id: string, orgId: string): Promise<boolean> {
	await schedulesDb.deleteById(id, orgId);
	return true;
}
