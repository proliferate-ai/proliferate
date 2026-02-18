/**
 * Drizzle database client
 *
 * Singleton pattern for database connection.
 * Uses postgres.js driver with Drizzle ORM.
 */

import { env } from "@proliferate/environment/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Prevent Next.js HMR from creating orphaned connection pools on every file save.
// Module-level `let` variables are reset when HMR re-evaluates the module,
// leaking the old postgres.js pool. globalThis survives HMR.
const globalForDb = globalThis as unknown as {
	pgSql: ReturnType<typeof postgres> | undefined;
	drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

const isDev = process.env.NODE_ENV === "development";

/**
 * Get the Drizzle database instance.
 * Creates connection on first call, reuses on subsequent calls.
 */
export function getDb() {
	if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

	// Create postgres.js connection
	const sql = postgres(env.DATABASE_URL, {
		max: 10,
		idle_timeout: 20,
		connect_timeout: isDev ? 30 : 10, // Survive Next.js cold compiles locally
	});

	// Create Drizzle instance with full schema for relations
	const db = drizzle(sql, { schema });

	globalForDb.pgSql = sql;
	globalForDb.drizzleDb = db;

	return db;
}

/**
 * Reset the database connection (for testing).
 */
export async function resetDb(): Promise<void> {
	if (globalForDb.pgSql) {
		await globalForDb.pgSql.end();
		globalForDb.pgSql = undefined;
	}
	globalForDb.drizzleDb = undefined;
}

/**
 * Type helper for the database instance.
 */
export type Database = ReturnType<typeof getDb>;
