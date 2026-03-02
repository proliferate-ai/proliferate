/**
 * Actions mapper.
 *
 * Maps action invocation DB rows to API DTOs.
 */

import { toIsoString } from "../db/serialize";
import type { ActionInvocationRow, ActionInvocationWithSession } from "./db";

export interface ActionInvocationDto {
	id: string;
	sessionId: string;
	organizationId: string;
	integrationId: string | null;
	integration: string;
	action: string;
	riskLevel: string;
	mode: string | null;
	modeSource: string | null;
	params: unknown;
	status: string;
	result: unknown;
	error: string | null;
	durationMs: number | null;
	approvedBy: string | null;
	approvedAt: string | null;
	completedAt: string | null;
	expiresAt: string | null;
	deniedReason: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface ActionInvocationWithSessionDto extends ActionInvocationDto {
	sessionTitle: string | null;
}

export function toActionInvocation(row: ActionInvocationRow): ActionInvocationDto {
	return {
		id: row.id,
		sessionId: row.sessionId,
		organizationId: row.organizationId,
		integrationId: row.integrationId,
		integration: row.integration,
		action: row.action,
		riskLevel: row.riskLevel,
		mode: row.mode,
		modeSource: row.modeSource,
		params: row.params,
		status: row.status,
		result: row.result,
		error: row.error,
		durationMs: row.durationMs,
		approvedBy: row.approvedBy,
		approvedAt: toIsoString(row.approvedAt),
		completedAt: toIsoString(row.completedAt),
		expiresAt: toIsoString(row.expiresAt),
		deniedReason: row.deniedReason,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.completedAt ?? row.approvedAt ?? row.createdAt),
	};
}

export function toActionInvocations(rows: ActionInvocationRow[]): ActionInvocationDto[] {
	return rows.map(toActionInvocation);
}

export function toActionInvocationWithSession(
	row: ActionInvocationWithSession,
): ActionInvocationWithSessionDto {
	return {
		...toActionInvocation(row),
		sessionTitle: row.sessionTitle,
	};
}

export function toActionInvocationsWithSession(
	rows: ActionInvocationWithSession[],
): ActionInvocationWithSessionDto[] {
	return rows.map(toActionInvocationWithSession);
}
