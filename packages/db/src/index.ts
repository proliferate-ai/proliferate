/**
 * @proliferate/db - Database layer using Drizzle ORM
 *
 * Provides type-safe database access with relational queries.
 */

// Client
export { getDb, resetDb, type Database } from "./client";

// Schema - tables and relations
export * from "./schema";

// Re-export common Drizzle utilities for convenience
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
} from "drizzle-orm";
export type { InferSelectModel, InferInsertModel, SQL } from "drizzle-orm";
