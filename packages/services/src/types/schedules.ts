/**
 * Schedules module types.
 *
 * DB row shapes and input types for schedules queries.
 */

// ============================================
// DB Row Types
// ============================================

export interface ScheduleRow {
	id: string;
	organization_id: string;
	automation_id: string;
	name: string | null;
	cron_expression: string;
	timezone: string | null;
	enabled: boolean | null;
	last_run_at: string | null;
	next_run_at: string | null;
	created_at: string | null;
	updated_at: string | null;
	created_by: string | null;
}

// ============================================
// DB Input Types
// ============================================

export interface UpdateScheduleDbInput {
	name?: string | null;
	cronExpression?: string;
	timezone?: string | null;
	enabled?: boolean;
}

export interface CreateScheduleDbInput {
	automationId: string;
	organizationId: string;
	name?: string | null;
	cronExpression: string;
	timezone?: string;
	enabled?: boolean;
	createdBy: string;
}

// ============================================
// Service Input Types
// ============================================

export interface UpdateScheduleInput {
	name?: string;
	cronExpression?: string;
	timezone?: string;
	enabled?: boolean;
}

export interface CreateScheduleInput {
	name?: string;
	cronExpression: string;
	timezone?: string;
	enabled?: boolean;
}
