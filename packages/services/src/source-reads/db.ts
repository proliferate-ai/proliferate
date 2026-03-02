/**
 * Source reads DB operations.
 *
 * Raw Drizzle queries for worker_source_bindings and worker_source_cursors.
 */

import {
	type InferSelectModel,
	and,
	eq,
	getDb,
	workerSourceBindings,
	workerSourceCursors,
} from "../db/client";

// ============================================
// Type Exports
// ============================================

export type SourceBindingRow = InferSelectModel<typeof workerSourceBindings>;
export type SourceCursorRow = InferSelectModel<typeof workerSourceCursors>;

// ============================================
// Binding Queries
// ============================================

export async function listBindingsByWorker(
	workerId: string,
	organizationId: string,
): Promise<SourceBindingRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workerSourceBindings)
		.where(
			and(
				eq(workerSourceBindings.workerId, workerId),
				eq(workerSourceBindings.organizationId, organizationId),
			),
		);
}

export async function findBindingById(
	bindingId: string,
	organizationId: string,
): Promise<SourceBindingRow | undefined> {
	const db = getDb();
	const rows = await db
		.select()
		.from(workerSourceBindings)
		.where(
			and(
				eq(workerSourceBindings.id, bindingId),
				eq(workerSourceBindings.organizationId, organizationId),
			),
		)
		.limit(1);
	return rows[0];
}

// ============================================
// Cursor Queries
// ============================================

export async function findCursorByBinding(bindingId: string): Promise<SourceCursorRow | undefined> {
	const db = getDb();
	const rows = await db
		.select()
		.from(workerSourceCursors)
		.where(eq(workerSourceCursors.bindingId, bindingId))
		.limit(1);
	return rows[0];
}

export async function upsertCursor(
	bindingId: string,
	cursorValue: string | null,
): Promise<SourceCursorRow> {
	const db = getDb();
	const now = new Date();

	const rows = await db
		.insert(workerSourceCursors)
		.values({
			bindingId,
			cursorValue,
			lastPolledAt: now,
		})
		.onConflictDoUpdate({
			target: workerSourceCursors.bindingId,
			set: { cursorValue, lastPolledAt: now },
		})
		.returning();

	return rows[0];
}
