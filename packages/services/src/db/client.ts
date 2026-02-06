/**
 * Database client exports.
 *
 * Drizzle ORM is the database layer.
 */

// Re-export Drizzle client and utilities from @proliferate/db
export { getDb, resetDb, type Database } from "@proliferate/db";

// Re-export common Drizzle utilities
export {
	eq,
	ne,
	gt,
	gte,
	lt,
	lte,
	and,
	or,
	not,
	inArray,
	notInArray,
	isNull,
	isNotNull,
	sql,
	desc,
	asc,
} from "@proliferate/db";
export type { InferSelectModel, SQL } from "@proliferate/db";

// Re-export schema
export * from "@proliferate/db/schema";
