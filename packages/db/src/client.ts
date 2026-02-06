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

// Singleton instances
let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Get the database connection string from environment.
 * Requires DATABASE_URL to be set.
 */
function getConnectionString(): string {
	return env.DATABASE_URL;
}

/**
 * Get the Drizzle database instance.
 * Creates connection on first call, reuses on subsequent calls.
 */
export function getDb() {
	if (db) return db;

	const connectionString = getConnectionString();

	// Create postgres.js connection
	sql = postgres(connectionString, {
		max: 10, // Connection pool size
		idle_timeout: 20, // Close idle connections after 20 seconds
		connect_timeout: 10, // Connection timeout
	});

	// Create Drizzle instance with full schema for relations
	db = drizzle(sql, { schema });

	return db;
}

/**
 * Reset the database connection (for testing).
 */
export async function resetDb(): Promise<void> {
	if (sql) {
		await sql.end();
		sql = null;
	}
	db = null;
}

/**
 * Type helper for the database instance.
 */
export type Database = ReturnType<typeof getDb>;
